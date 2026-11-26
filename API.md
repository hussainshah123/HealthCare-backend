# Healthcare Platform – API Contract (v1)

Base URL: `http://<host>:3000/api`  (Android emulator: `http://10.0.2.2:3000/api`)
Auth: `Authorization: Bearer <accessToken>` on every route except those marked **public**.
Errors: `{ statusCode, message, error? }` — `message` may be a string or string[] (validation).
Paginated lists: `?page=1&limit=20` → `{ items: T[], total, page, limit }`.
IDs are UUID strings. Money is a number in the platform currency (PKR by default). Dates are ISO strings.

## Roles
`CUSTOMER | DOCTOR | RIDER | PHARMACY | ADMIN`
Account `status`: `PENDING | ACTIVE | REJECTED | SUSPENDED`. Doctors, riders and pharmacies start `PENDING` until an admin approves them; customers start `ACTIVE`.

## Auth  (`/auth`)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST public | /auth/register | `{ name, email, phone, password, role: CUSTOMER\|DOCTOR\|RIDER\|PHARMACY, lat?, lng? }` | `AuthResponse` (201) |
| POST public | /auth/login | `{ email, password }` | `AuthResponse` |
| POST public | /auth/refresh | `{ refreshToken }` | `AuthResponse` |
| POST | /auth/logout | `{ refreshToken }` | 204 |
| GET | /auth/me | – | `User` |

`AuthResponse = { accessToken, refreshToken, expiresIn (seconds), user: User }` — refresh tokens rotate: each works once; reusing one revokes the whole session (sign in again). Access tokens live 15 min, refresh tokens 30 days.
`User = { id, name, email, phone, role, status, avatarUrl, createdAt }`

Sign-up location (optional, send both `lat` and `lng` from the phone's GPS): saved on the user with the looked-up city. A CUSTOMER also gets it as a default "Home" address (street and city filled in by reverse geocoding when available); a RIDER gets it as their last known position; a PHARMACY as the shop location. Sign-up never fails because the lookup fails.

## Geo  (`/geo`, any signed-in user)
- `GET /geo/reverse?lat=&lng=` → `{ line1, city }` to pre-fill an address form; 404 when nothing is found. Rate-limited to 20/min. Uses OpenStreetMap Nominatim unless `GEOCODER_URL` points elsewhere (`GEOCODER_USER_AGENT` optional).

## Customer  (`/customers`, role CUSTOMER)
- `GET /customers/me` → `{ id, name, email, phone, avatarUrl, dateOfBirth (YYYY-MM-DD|null), gender }` · `PATCH /customers/me { name?, phone?, dateOfBirth?, gender?: MALE|FEMALE|OTHER }`
- Addresses → `{ id, label, line1, line2, city, lat, lng, isDefault }` (plain array for the list)
- `GET /customers/me/addresses` · `POST /customers/me/addresses { label, line1, line2?, city, lat?, lng?, isDefault? }` · `DELETE /customers/me/addresses/:id`

## Catalogue (any signed-in user)
- `GET /categories` → `Category[] { id, name, imageUrl }`
- `GET /medicines?search=&categoryId=&page=&limit=` → paginated `Medicine`
- `GET /medicines/:id` → `Medicine & { offers: { pharmacyId, pharmacyName, price, stock }[] }`
- `Medicine = { id, name, brand, manufacturer, description, dosage, form, packSize, imageUrl, requiresPrescription, categoryId, minPrice }` (`form`: Tablet, Capsule, Syrup, Suspension, Drops, Cream, Ointment, Gel, Sachet, Injection; `packSize` e.g. "Strip of 10 tablets"). The seed catalogue lives in `src/database/data/medicines.ts`.
- Admin: `POST /medicines`, `PATCH /medicines/:id`, `POST /categories`

## Pharmacies & inventory
- `GET /pharmacies` → approved pharmacies `{ id, name, address, city, lat, lng }[]`
- Role PHARMACY: `GET /pharmacies/me` → `{ id, name, address, city, licenseNumber, lat, lng, status }`, `PATCH /pharmacies/me { name?, address?, city?, licenseNumber?, lat?, lng? }`
- Role PHARMACY: `GET /inventory` → paginated `{ id, medicineId, medicineName, requiresPrescription, price, stock, batchNumber, expiryDate, updatedAt }`, `POST /inventory { medicineId, price, stock, batchNumber?, expiryDate? }`, `PATCH /inventory/:id { price?, stock?, batchNumber?, expiryDate? }`
- Role PHARMACY, CSV import: `GET /inventory/template.csv` → CSV of every catalogue medicine prefilled with this pharmacy's price/stock (`medicine,category,price,stock,batchNumber,expiryDate`). `POST /inventory/bulk { rows: { row, medicine, price, stock, batchNumber?, expiryDate? }[] (max 2000, values as strings), dryRun? }` → `{ dryRun, created, updated, failed, rows: { row, medicine, status: create|update|error, reason? }[] }`. Medicines match the catalogue by name (case-insensitive); bad rows are reported and skipped, good rows are upserted. Accepts prices like `Rs 1,300` and dates `2027-12-31` or `31/12/2027`. `dryRun: true` saves nothing.

## Cart (role CUSTOMER)
- `GET /cart` → `{ items: CartItem[], subtotal }`, `CartItem = { id, medicineId, medicineName, imageUrl, pharmacyId, price, quantity, requiresPrescription }`
- `POST /cart/items { medicineId, pharmacyId, quantity }` · `PATCH /cart/items/:id { quantity }` · `DELETE /cart/items/:id` · `DELETE /cart` (clear)
- A cart holds items from **one pharmacy**; adding from another pharmacy answers 409.

## Prescriptions (uploaded by customer)
- CUSTOMER: `POST /prescriptions` multipart `file` (jpg/png/pdf ≤ 10 MB), optional `notes` → `Prescription`
- CUSTOMER: `GET /prescriptions/me`
- `GET /prescriptions/:id/file` → the file (owner, the pharmacy of a linked order, or admin). Needs the bearer header, so download it with the token rather than opening `fileUrl` in a browser.
- PHARMACY: `PATCH /prescriptions/:id/review { approved: boolean, note? }`
- `Prescription = { id, fileUrl, notes, status: PENDING|APPROVED|REJECTED, reviewNote, createdAt }`

## Orders
- CUSTOMER: `POST /orders { addressId, paymentMethod: COD|ONLINE, prescriptionId?, couponCode? }` → `Order` (created from the cart, cart is emptied)
- CUSTOMER: `GET /orders/me` (paginated) · `GET /orders/:id` · `POST /orders/:id/cancel { reason? }` (only before pickup) · `POST /orders/:id/reorder` (refills cart)
- PHARMACY: `GET /orders/pharmacy?status=` · `PATCH /orders/:id/status { status, note? }`
- `Order = { id, orderNumber, status, paymentMethod, paymentStatus, subtotal, deliveryFee, discount, total, items: { medicineId, name, price, quantity }[], address, pharmacy: { id, name }, prescriptionId, history: { status, note, createdAt }[], delivery: Delivery|null, deliveryOtp? (customer only, while active), createdAt }`
- Status flow (server enforced): `PENDING → PRESCRIPTION_UNDER_REVIEW → CONFIRMED → PREPARING → READY_FOR_PICKUP → RIDER_ASSIGNED → PICKED_UP → ON_THE_WAY → DELIVERED`; `CANCELLED`, `RETURNED`.
  Pharmacy may set: CONFIRMED, PREPARING, READY_FOR_PICKUP, CANCELLED. Rider endpoints drive the rest.

## Riders & deliveries
- RIDER: `GET /riders/me` → `{ id, name, email, phone, status, avatarUrl, vehicleType, vehicleNumber, licenseNumber, cnic, online }`
- RIDER: `PATCH /riders/me { vehicleType?: MOTORCYCLE|BICYCLE|CAR, vehicleNumber?, licenseNumber?, cnic? (13 digits, dashes optional) }` · `PATCH /riders/me/availability { online: boolean }` → rider profile (going offline with an active delivery is 409; going online needs ACTIVE status)
- RIDER: `GET /riders/me/earnings` → `{ total, deliveries, items: { deliveryId, orderNumber, fee, deliveredAt }[] }`
- RIDER: `GET /deliveries/available` → `{ orderId, orderNumber, fee, pharmacy: { name, address, lat, lng }, dropoff: { city, lat, lng }, readyAt }[]` (plain array; rider must be ACTIVE and online, else 403)
- RIDER: `GET /deliveries/active` → `Delivery | null` · `GET /deliveries/history` (paginated)
- RIDER: `POST /deliveries/:orderId/accept` → `Delivery`
- RIDER: `POST /deliveries/:id/reject` · `POST /deliveries/:id/pickup` · `POST /deliveries/:id/start` (ON_THE_WAY) · `POST /deliveries/:id/complete { otp }`
- RIDER: `POST /deliveries/:id/location { lat, lng, heading?, speed? }` (HTTP fallback; prefer socket)
- CUSTOMER: `GET /deliveries/order/:orderId/tracking` → `{ delivery: Delivery, rider: { name, phone, avatarUrl, vehicleNumber }, lastLocation: { lat, lng, heading, recordedAt } | null, destination: { lat, lng, line1 } , pharmacy: { lat, lng, name } }` (only while RIDER_ASSIGNED..ON_THE_WAY)
- `Delivery = { id, orderId, orderNumber, status: ASSIGNED|PICKED_UP|ON_THE_WAY|DELIVERED|CANCELLED, fee, pharmacy: { name, address, lat, lng }, dropoff: { line1, city, lat, lng }, customerName, customerPhone, assignedAt, pickedUpAt, deliveredAt }`

## Doctors
- `GET /specializations` → `{ id, name }[]`
- `GET /doctors?search=&specializationId=&maxFee=&page=&limit=` → paginated approved `DoctorCard { id, name, avatarUrl, specialization (name string | null), specializationId, experienceYears, fee, rating, ratingCount, languages }`
- `GET /doctors/:id` → `DoctorCard & { qualifications, registrationNumber, bio, reviews: { rating, comment, customerName, createdAt }[] }`
- `GET /doctors/:id/slots?date=YYYY-MM-DD` → `{ startsAt, endsAt, available }[]`
- DOCTOR: `GET /doctors/me` → `DoctorDetail & { email, phone, status }` · `PATCH /doctors/me { specializationId?, qualifications?, registrationNumber?, experienceYears?, fee?, bio?, languages? }`
- DOCTOR: `GET /doctors/me/availability` → plain array `{ dayOfWeek, startTime, endTime, slotMinutes }[]` · `PUT /doctors/me/availability { slots: { dayOfWeek: 0-6, startTime: "09:00", endTime: "17:00", slotMinutes: 15|20|30|60 }[] }`
- DOCTOR: `GET /doctors/me/earnings` → `{ gross, commission, net, consultations, items: { appointmentId, patientName, startsAt, gross, commission, net }[], payouts: { id, amount, status, periodStart, periodEnd }[] }`

## Appointments & consultations
- CUSTOMER: `POST /appointments { doctorId, startsAt, type: AUDIO|VIDEO|CHAT, reason? }` → `Appointment` (409 when the slot is taken)
- CUSTOMER or DOCTOR: `GET /appointments/me?status=` → their own appointments (paginated)
- `GET /appointments/:id` (participants/admin)
- DOCTOR: `POST /appointments/:id/accept` · `POST /appointments/:id/reject { reason? }`
- CUSTOMER or DOCTOR: `POST /appointments/:id/cancel { reason? }`
- `Appointment = { id, status: REQUESTED|CONFIRMED|IN_PROGRESS|COMPLETED|CANCELLED|REJECTED, type, startsAt, endsAt, fee, reason, doctor: { id, name, specialization, avatarUrl }, customer: { id, name }, consultationId }`
- DOCTOR: `POST /consultations/:appointmentId/start` → `Consultation`
- Participants: `GET /consultations/:id` · `POST /consultations/:id/end` (doctor) · `GET /consultations/:id/messages` → plain array `{ id, senderId, body, createdAt }[]` · `POST /consultations/:id/messages { body }`
- DOCTOR: `POST /consultations/:id/prescription { diagnosis, notes?, items: { medicineName, dosage, frequency, durationDays, instructions? }[] }`
- CUSTOMER: `GET /doctor-prescriptions/me` · participants: `GET /doctor-prescriptions/:id`
- `Consultation = { id, appointmentId, status: WAITING|ACTIVE|ENDED, type, roomId, startedAt, endedAt, doctor: { id, name }, customer: { id, name }, prescriptionId }`
- `DoctorPrescription = { id, consultationId, diagnosis, notes, doctor: { id, name, specialization, registrationNumber }, patient: { id, name }, items: { medicineName, dosage, frequency, durationDays, instructions }[], createdAt }` (`GET /doctor-prescriptions/me` returns a plain array)

## Payments
- CUSTOMER: `GET /payments/me` → paginated `{ id, orderId, appointmentId, amount, currency, method, status, gatewayRef, createdAt, orderNumber, userName }` (admin list has the same shape)
- `POST /payments/webhook { paymentId, status: PAID|FAILED, gatewayRef, raw? }` public; header `x-signature` = hex HMAC-SHA256 of the raw body with `PAYMENT_WEBHOOK_SECRET`

## Notifications
- `GET /notifications` → paginated `{ id, type, title, body, data, readAt, createdAt }` plus `unread` count · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all`
- `POST /notifications/device-token { token, platform: android|ios }` (FCM)

## Admin (role ADMIN)
- `GET /admin/stats` → `{ customers, doctors, riders, pharmacies, orders, activeDeliveries, consultations, revenue, pendingApprovals }`
- `GET /admin/users?role=&status=&search=&page=&limit=` → paginated `User & { profile }`
- `PATCH /admin/users/:id/status { status: ACTIVE|REJECTED|SUSPENDED, note? }` (approve/reject doctors, riders, pharmacies)
- `GET /admin/orders?status=&search=&page=` · `GET /admin/orders/:id`
- `POST /admin/deliveries/assign { orderId, riderId }` → `Delivery` · `GET /admin/deliveries/active` → plain `Delivery[]` · `GET /admin/riders/online` → plain `{ id, name, phone, vehicleType, vehicleNumber, lastLat, lastLng, lastSeenAt, busy }[]`
- `GET /admin/appointments?status=&page=`
- `GET /admin/payments?page=`
- `GET /admin/settings` · `PUT /admin/settings { deliveryFee, platformCommissionPercent, doctorCommissionPercent, riderFeePercent, serviceCities: string[] }`
- `POST /specializations` · `POST /categories`

## Real-time (Socket.IO)
Connect to `http://<host>:3000` with `auth: { token: accessToken }`. Namespaces:

`/tracking`
- client → `delivery:join { orderId }` (customer of that order or admin) → ack `{ ok, lastLocation? }`
- client → `delivery:leave { orderId }`
- rider → `rider:location { deliveryId, lat, lng, heading?, speed? }` (only the assigned rider, only while active)
- server → `rider:location { orderId, lat, lng, heading, speed, recordedAt }`
- server → `delivery:status { orderId, status }`  (also sent when tracking ends)

`/consultations`
- client → `consultation:join { consultationId }` (participants only)
- client → `consultation:message { consultationId, body }` → server broadcasts `consultation:message { id, senderId, body, createdAt }`
- WebRTC signalling relay: `webrtc:offer|webrtc:answer|webrtc:ice { consultationId, data }` → relayed to the other participant
- server → `consultation:ended { consultationId }`

`/notifications` – server → `notification { id, title, body, type, data }` and `appointment:updated`.
