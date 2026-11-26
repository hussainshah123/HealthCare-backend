import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BulkInventoryDto,
  BulkInventoryResultDto,
  BulkInventoryRowResult,
  CreateInventoryDto,
  InventoryResponseDto,
  PharmacyResponseDto,
  UpdateInventoryDto,
  UpdatePharmacyDto,
} from './dto/pharmacy.dto.js';

@Injectable()
export class PharmaciesService {
  constructor(private readonly prisma: PrismaService) {}

  async listApproved() {
    const rows = await this.prisma.pharmacyProfile.findMany({
      where: { user: { status: 'ACTIVE' } },
      orderBy: { name: 'asc' },
    });
    return rows.map((p) => ({
      id: p.userId,
      name: p.name,
      address: p.address,
      city: p.city,
      lat: p.lat,
      lng: p.lng,
    }));
  }

  async getMine(userId: string): Promise<PharmacyResponseDto> {
    const p = await this.prisma.pharmacyProfile.findUnique({
      where: { userId },
      include: { user: { select: { status: true } } },
    });
    if (!p) throw new NotFoundException('Pharmacy profile not found');
    return {
      id: p.userId,
      name: p.name,
      address: p.address,
      city: p.city,
      licenseNumber: p.licenseNumber,
      lat: p.lat,
      lng: p.lng,
      status: p.user.status,
    };
  }

  async updateMine(userId: string, dto: UpdatePharmacyDto) {
    await this.prisma.pharmacyProfile.update({ where: { userId }, data: dto });
    return this.getMine(userId);
  }

  async listInventory(pharmacyId: string, query: PaginationQueryDto) {
    const where = { pharmacyId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.pharmacyInventory.findMany({
        where,
        include: { medicine: { select: { name: true, requiresPrescription: true } } },
        orderBy: { medicine: { name: 'asc' } },
        ...pageArgs(query),
      }),
      this.prisma.pharmacyInventory.count({ where }),
    ]);
    return paginated(rows.map(toInventory), total, query);
  }

  async addInventory(pharmacyId: string, dto: CreateInventoryDto): Promise<InventoryResponseDto> {
    const medicine = await this.prisma.medicine.count({ where: { id: dto.medicineId } });
    if (!medicine) throw new NotFoundException('Medicine not found');
    try {
      const row = await this.prisma.pharmacyInventory.create({
        data: {
          pharmacyId,
          medicineId: dto.medicineId,
          price: dto.price,
          stock: dto.stock,
          batchNumber: dto.batchNumber,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        },
        include: { medicine: { select: { name: true, requiresPrescription: true } } },
      });
      return toInventory(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('This medicine is already in your inventory; update it instead');
      }
      throw error;
    }
  }

  async updateInventory(pharmacyId: string, id: string, dto: UpdateInventoryDto) {
    const { count } = await this.prisma.pharmacyInventory.updateMany({
      where: { id, pharmacyId },
      data: {
        price: dto.price,
        stock: dto.stock,
        batchNumber: dto.batchNumber,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
    if (count === 0) throw new NotFoundException('Inventory item not found');
    const row = await this.prisma.pharmacyInventory.findUniqueOrThrow({
      where: { id },
      include: { medicine: { select: { name: true, requiresPrescription: true } } },
    });
    return toInventory(row);
  }

  /**
   * Adds or updates many inventory rows from a CSV upload. Medicines are matched
   * by name (case-insensitive) against the catalogue. Each row is checked on its
   * own; bad rows are reported and skipped, good rows are saved together.
   */
  async bulkUpsertInventory(pharmacyId: string, dto: BulkInventoryDto): Promise<BulkInventoryResultDto> {
    const [medicines, existing] = await Promise.all([
      this.prisma.medicine.findMany({ select: { id: true, name: true } }),
      this.prisma.pharmacyInventory.findMany({ where: { pharmacyId }, select: { medicineId: true } }),
    ]);
    const byName = new Map(medicines.map((m) => [normalizeName(m.name), m]));
    const stocked = new Set(existing.map((e) => e.medicineId));
    const seen = new Map<string, number>(); // medicineId -> first row

    const results: BulkInventoryRowResult[] = [];
    const writes: { medicineId: string; price: number; stock: number; batchNumber: string | null; expiryDate: Date | null }[] = [];

    for (const r of dto.rows) {
      const name = (r.medicine ?? '').trim();
      const fail = (reason: string) => results.push({ row: r.row, medicine: name, status: 'error', reason });
      if (!name) {
        fail('Medicine name is missing');
        continue;
      }
      const med = byName.get(normalizeName(name));
      if (!med) {
        fail('Not in the MediGo catalogue (check the spelling, or ask an admin to add it)');
        continue;
      }
      const price = parsePrice(r.price);
      if (price === null) {
        fail('Price must be a number from 0 to 1,000,000 (up to 2 decimals)');
        continue;
      }
      const stock = parseStock(r.stock);
      if (stock === null) {
        fail('Stock must be a whole number, 0 or more');
        continue;
      }
      const batch = (r.batchNumber ?? '').trim();
      if (batch.length > 60) {
        fail('Batch number is too long (max 60 characters)');
        continue;
      }
      const expiry = parseDate(r.expiryDate);
      if (expiry === undefined) {
        fail('Expiry date must look like 2027-12-31 or 31/12/2027');
        continue;
      }
      const first = seen.get(med.id);
      if (first !== undefined) {
        fail(`Same medicine as row ${first}; keep one row per medicine`);
        continue;
      }
      seen.set(med.id, r.row);
      writes.push({ medicineId: med.id, price, stock, batchNumber: batch || null, expiryDate: expiry });
      results.push({ row: r.row, medicine: med.name, status: stocked.has(med.id) ? 'update' : 'create' });
    }

    if (!dto.dryRun && writes.length) {
      // Chunked so a large file doesn't become one huge transaction.
      for (let i = 0; i < writes.length; i += 200) {
        await this.prisma.$transaction(
          writes.slice(i, i + 200).map((w) =>
            this.prisma.pharmacyInventory.upsert({
              where: { pharmacyId_medicineId: { pharmacyId, medicineId: w.medicineId } },
              create: { pharmacyId, ...w },
              update: { price: w.price, stock: w.stock, batchNumber: w.batchNumber, expiryDate: w.expiryDate },
            }),
          ),
        );
      }
    }

    results.sort((a, b) => a.row - b.row);
    return {
      dryRun: !!dto.dryRun,
      created: results.filter((x) => x.status === 'create').length,
      updated: results.filter((x) => x.status === 'update').length,
      failed: results.filter((x) => x.status === 'error').length,
      rows: results,
    };
  }

  /** CSV template: every catalogue medicine, prefilled with this pharmacy's current values. */
  async inventoryTemplateCsv(pharmacyId: string): Promise<string> {
    const [medicines, inventory] = await Promise.all([
      this.prisma.medicine.findMany({
        select: { id: true, name: true, category: { select: { name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.pharmacyInventory.findMany({ where: { pharmacyId } }),
    ]);
    const mine = new Map(inventory.map((i) => [i.medicineId, i]));
    const lines = [['medicine', 'category', 'price', 'stock', 'batchNumber', 'expiryDate'].join(',')];
    for (const m of medicines) {
      const inv = mine.get(m.id);
      lines.push(
        [
          m.name,
          m.category.name,
          inv ? String(toMoney(inv.price)) : '',
          inv ? String(inv.stock) : '',
          inv?.batchNumber ?? '',
          inv?.expiryDate ? inv.expiryDate.toISOString().slice(0, 10) : '',
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\r\n') + '\r\n';
  }
}

function normalizeName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parsePrice(v?: string): number | null {
  const s = (v ?? '').replace(/,/g, '').replace(/^(rs\.?|pkr)\s*/i, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 1_000_000 ? n : null;
}

function parseStock(v?: string): number | null {
  const s = (v ?? '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= 10_000_000 ? n : null;
}

/** null = no date given; undefined = given but invalid. Accepts YYYY-MM-DD and DD/MM/YYYY. */
function parseDate(v?: string): Date | null | undefined {
  const s = (v ?? '').trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
  return date;
}

/** Quote a CSV cell when needed, and defuse spreadsheet formulas. */
function csvCell(value: string) {
  let v = value;
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toInventory(row: {
  id: string;
  medicineId: string;
  price: { toString(): string };
  stock: number;
  batchNumber: string | null;
  expiryDate: Date | null;
  updatedAt: Date;
  medicine: { name: string; requiresPrescription: boolean };
}): InventoryResponseDto {
  return {
    id: row.id,
    medicineId: row.medicineId,
    medicineName: row.medicine.name,
    requiresPrescription: row.medicine.requiresPrescription,
    price: toMoney(row.price),
    stock: row.stock,
    batchNumber: row.batchNumber,
    expiryDate: row.expiryDate?.toISOString().slice(0, 10) ?? null,
    updatedAt: row.updatedAt,
  };
}
