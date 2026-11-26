/**
 * Seeds the first admin and reference data. Safe to run more than once.
 *   npm run build && npm run db:seed
 */
import 'dotenv/config';
import { PasswordHasher } from '@nestjs/authentication';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const CATEGORIES = ['Pain Relief', 'Antibiotics', 'Diabetes', 'Heart & Blood Pressure', 'Vitamins & Supplements', 'Cold & Flu', 'Skin Care', 'Baby Care'];
const SPECIALIZATIONS = ['General Physician', 'Pediatrician', 'Dermatologist', 'Gynecologist', 'Cardiologist', 'Psychiatrist', 'ENT Specialist', 'Orthopedic Surgeon', 'Diabetologist', 'Nutritionist'];
const MEDICINES = [
  { name: 'Panadol 500mg', brand: 'Panadol', manufacturer: 'GSK', category: 'Pain Relief', requiresPrescription: false, dosage: '1–2 tablets every 4–6 hours, max 8 a day' },
  { name: 'Brufen 400mg', brand: 'Brufen', manufacturer: 'Abbott', category: 'Pain Relief', requiresPrescription: false, dosage: '1 tablet three times a day after meals' },
  { name: 'Augmentin 625mg', brand: 'Augmentin', manufacturer: 'GSK', category: 'Antibiotics', requiresPrescription: true, dosage: 'As prescribed' },
  { name: 'Glucophage 500mg', brand: 'Glucophage', manufacturer: 'Merck', category: 'Diabetes', requiresPrescription: true, dosage: 'As prescribed' },
  { name: 'Concor 5mg', brand: 'Concor', manufacturer: 'Merck', category: 'Heart & Blood Pressure', requiresPrescription: true, dosage: 'As prescribed' },
  { name: 'Surbex-Z', brand: 'Surbex', manufacturer: 'Abbott', category: 'Vitamins & Supplements', requiresPrescription: false, dosage: '1 tablet daily' },
  { name: 'Arinac Forte', brand: 'Arinac', manufacturer: 'Abbott', category: 'Cold & Flu', requiresPrescription: false, dosage: '1 tablet twice a day' },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8+ characters) in .env');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        name: 'Platform Admin',
        email,
        phone: '+920000000000',
        passwordHash: await new PasswordHasher().hash(password),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    console.log(`Admin created: ${email}`);
  } else {
    console.log(`Admin already exists: ${email}`);
  }

  for (const name of CATEGORIES) {
    await prisma.medicineCategory.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const name of SPECIALIZATIONS) {
    await prisma.specialization.upsert({ where: { name }, create: { name }, update: {} });
  }
  for (const m of MEDICINES) {
    if (await prisma.medicine.findFirst({ where: { name: m.name } })) continue;
    const category = await prisma.medicineCategory.findUniqueOrThrow({ where: { name: m.category } });
    await prisma.medicine.create({
      data: {
        name: m.name,
        brand: m.brand,
        manufacturer: m.manufacturer,
        dosage: m.dosage,
        requiresPrescription: m.requiresPrescription,
        categoryId: category.id,
      },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories, ${SPECIALIZATIONS.length} specializations, ${MEDICINES.length} medicines`);

  if (process.env.SEED_DEMO_USERS === 'true') await seedDemoUsers();
}

/**
 * Approved demo accounts, one per role, for development only (SEED_DEMO_USERS=true).
 * Never enable on a production database: the password is known.
 */
async function seedDemoUsers() {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'Demo@12345';
  const passwordHash = await new PasswordHasher().hash(password);
  const general = await prisma.specialization.findUniqueOrThrow({ where: { name: 'General Physician' } });
  const demo: (Omit<Prisma.UserCreateInput, 'passwordHash' | 'status'> & { email: string })[] = [
    { role: 'CUSTOMER', name: 'Demo Customer', email: 'customer@demo.pk', phone: '+923000000001', customerProfile: { create: {} } },
    {
      role: 'DOCTOR', name: 'Dr. Demo Doctor', email: 'doctor@demo.pk', phone: '+923000000002',
      doctorProfile: { create: { specialization: { connect: { id: general.id } }, fee: 1500, experienceYears: 8, qualifications: 'MBBS, FCPS', registrationNumber: 'PMDC-00000', languages: ['English', 'Urdu'] } },
    },
    { role: 'RIDER', name: 'Demo Rider', email: 'rider@demo.pk', phone: '+923000000003', riderProfile: { create: { vehicleType: 'MOTORCYCLE', vehicleNumber: 'LEA-1234' } } },
    { role: 'PHARMACY', name: 'Demo Pharmacy', email: 'pharmacy@demo.pk', phone: '+923000000004', pharmacyProfile: { create: { name: 'Demo Pharmacy', address: 'Mall Road', city: 'Lahore', lat: 31.5546, lng: 74.3572 } } },
  ];

  for (const u of demo) {
    if (await prisma.user.findUnique({ where: { email: u.email } })) continue;
    await prisma.user.create({
      data: { ...u, passwordHash, status: 'ACTIVE' },
    });
  }

  // Stock every medicine at the demo pharmacy, and give the doctor a weekday schedule.
  const pharmacy = await prisma.user.findUniqueOrThrow({ where: { email: 'pharmacy@demo.pk' } });
  for (const m of await prisma.medicine.findMany()) {
    await prisma.pharmacyInventory.upsert({
      where: { pharmacyId_medicineId: { pharmacyId: pharmacy.id, medicineId: m.id } },
      create: { pharmacyId: pharmacy.id, medicineId: m.id, price: 100, stock: 50 },
      update: {},
    });
  }
  const doctor = await prisma.user.findUniqueOrThrow({ where: { email: 'doctor@demo.pk' } });
  if ((await prisma.doctorAvailability.count({ where: { doctorId: doctor.id } })) === 0) {
    await prisma.doctorAvailability.createMany({
      data: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ doctorId: doctor.id, dayOfWeek, startTime: '10:00', endTime: '18:00', slotMinutes: 30 })),
    });
  }
  console.log(`Demo users ready (password: ${password}): ${demo.map((d) => d.email).join(', ')}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
