import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated } from '../common/pagination.js';
import { isNotFound, isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateCategoryDto,
  CreateMedicineDto,
  ListMedicinesQueryDto,
  MedicineDetailResponseDto,
  MedicineResponseDto,
  UpdateMedicineDto,
} from './dto/medicine.dto.js';

/** Stock that customers may buy: in stock, at an approved pharmacy. */
const sellableStock = {
  stock: { gt: 0 },
  pharmacy: { user: { status: 'ACTIVE' } },
} satisfies Prisma.PharmacyInventoryWhereInput;

@Injectable()
export class MedicinesService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories() {
    return this.prisma.medicineCategory.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, imageUrl: true },
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    try {
      return await this.prisma.medicineCategory.create({
        data: dto,
        select: { id: true, name: true, imageUrl: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Category already exists');
      throw error;
    }
  }

  async list(query: ListMedicinesQueryDto) {
    const where: Prisma.MedicineWhereInput = {
      categoryId: query.categoryId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { brand: { contains: query.search, mode: 'insensitive' } },
              { manufacturer: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.medicine.findMany({
        where,
        orderBy: { name: 'asc' },
        ...pageArgs(query),
        include: {
          inventory: { where: sellableStock, orderBy: { price: 'asc' }, take: 1, select: { price: true } },
        },
      }),
      this.prisma.medicine.count({ where }),
    ]);
    const items = rows.map((row) => toMedicine(row, row.inventory[0]?.price ?? null));
    return paginated(items, total, query);
  }

  async findOne(id: string): Promise<MedicineDetailResponseDto> {
    const row = await this.prisma.medicine.findUnique({
      where: { id },
      include: {
        inventory: {
          where: sellableStock,
          orderBy: { price: 'asc' },
          include: { pharmacy: { select: { userId: true, name: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException('Medicine not found');
    return {
      ...toMedicine(row, row.inventory[0]?.price ?? null),
      offers: row.inventory.map((inv) => ({
        pharmacyId: inv.pharmacy.userId,
        pharmacyName: inv.pharmacy.name,
        price: toMoney(inv.price),
        stock: inv.stock,
      })),
    };
  }

  async create(dto: CreateMedicineDto): Promise<MedicineResponseDto> {
    await this.ensureCategory(dto.categoryId);
    const row = await this.prisma.medicine.create({ data: dto });
    return toMedicine(row, null);
  }

  async update(id: string, dto: UpdateMedicineDto): Promise<MedicineResponseDto> {
    if (dto.categoryId) await this.ensureCategory(dto.categoryId);
    try {
      await this.prisma.medicine.update({ where: { id }, data: dto });
    } catch (error) {
      if (isNotFound(error)) throw new NotFoundException('Medicine not found');
      throw error;
    }
    return this.findOne(id);
  }

  private async ensureCategory(id: string) {
    const exists = await this.prisma.medicineCategory.count({ where: { id } });
    if (!exists) throw new NotFoundException('Category not found');
  }
}

function toMedicine(
  row: {
    id: string;
    name: string;
    brand: string | null;
    manufacturer: string | null;
    description: string | null;
    dosage: string | null;
    form: string | null;
    packSize: string | null;
    imageUrl: string | null;
    requiresPrescription: boolean;
    categoryId: string;
  },
  minPrice: { toString(): string } | null,
): MedicineResponseDto {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    manufacturer: row.manufacturer,
    description: row.description,
    dosage: row.dosage,
    form: row.form,
    packSize: row.packSize,
    imageUrl: row.imageUrl,
    requiresPrescription: row.requiresPrescription,
    categoryId: row.categoryId,
    minPrice: minPrice === null ? null : toMoney(minPrice),
  };
}
