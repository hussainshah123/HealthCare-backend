import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
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
