# Healthcare Delivery Platform – Backend

NestJS 12 + PostgreSQL (Prisma 7) + Socket.IO. Serves the React Native app (customer, doctor, rider) and the Next.js admin/pharmacy portal. The full API contract is in [API.md](API.md); Swagger UI runs at `/api/docs`.

## Setup

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # set DATABASE_URL, JWT_SECRET (openssl rand -base64 32), SEED_ADMIN_*
npx prisma migrate deploy        # create the tables
npm run build && npm run db:seed # first admin + categories, specializations, sample medicines
npm run start:dev                # http://localhost:3000/api
```

No Postgres installed? `npx prisma dev -n healthcare --detach` starts a local one and prints its URL.

## Layout

One folder per feature under `src/`, each with `*.module.ts`, `*.controller.ts` (HTTP only), `*.service.ts` (rules + queries) and `dto/` (class-validator request/response DTOs):

| Module | Covers |
|---|---|
| `auth` | register/login/refresh/logout, JWT guard, refresh tokens in Postgres, `RolesPolicy`, socket auth |
| `customers` | profile, addresses |
| `medicines` | catalogue, categories |
| `pharmacies` | pharmacy profile, inventory |
| `cart`, `orders` | cart (one pharmacy), checkout, order status machine (`orders/order-status.ts`) |
| `prescriptions` | uploads (private storage, magic-byte check), pharmacist review |
| `riders`, `deliveries` | rider profile/availability/earnings, dispatch, OTP delivery, `/tracking` live location gateway |
| `doctors`, `appointments`, `consultations` | doctor search/slots/availability, slot-locked booking, chat + WebRTC signalling, digital prescriptions |
| `payments`, `notifications`, `admin`, `settings` | signed webhooks, in-app + push notifications, admin dashboard APIs, platform settings |

## Rules the server enforces

- Every route needs a signed-in user unless marked public; role checks use `@Can(RolesPolicy, '<role>')`.
- Doctors, riders and pharmacies start `PENDING` and can't take work until an admin approves them.
- Order status changes only move along the table in `orders/order-status.ts`; concurrent changes can't both win.
- Stock is held at checkout and returned on cancellation.
- A slot can't be double-booked (unique slot lock); a delivery is completed only with the customer's 4-digit OTP.
- Live location is shared only during an active delivery, only with that order's customer (and admins).

## Tests

```bash
npm test        # unit tests (status machine, doctor slots)
npm run lint
```

## Not done yet

- FCM push sending (`notifications/push.service.ts` logs instead; needs a Firebase service account).
- Payment gateway integration beyond the signed webhook; refunds.
- S3 storage (`files/storage.service.ts` writes to `UPLOAD_DIR` on disk).
- Rider location retention job (delete old `rider_locations` rows after the agreed period).
