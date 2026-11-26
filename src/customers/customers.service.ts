import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AddressResponseDto,
  CreateAddressDto,
  CustomerProfileResponseDto,
  UpdateCustomerDto,
} from './dto/customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<CustomerProfileResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { customerProfile: true },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      dateOfBirth: user.customerProfile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: user.customerProfile?.gender ?? null,
    };
  }

  async updateProfile(userId: string, dto: UpdateCustomerDto) {
    const profile = {
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      gender: dto.gender,
    };
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name,
          phone: dto.phone,
          customerProfile: { upsert: { create: profile, update: profile } },
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Phone number is already in use');
      throw error;
    }
    return this.getProfile(userId);
  }

  async listAddresses(userId: string): Promise<AddressResponseDto[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toAddress);
  }

  async addAddress(userId: string, dto: CreateAddressDto): Promise<AddressResponseDto> {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      const isDefault = dto.isDefault ?? count === 0;
      if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      const row = await tx.address.create({ data: { ...dto, userId, isDefault } });
      return toAddress(row);
    });
  }

  async deleteAddress(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.address.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Address not found');
  }
}

function toAddress(row: {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}): AddressResponseDto {
  return {
    id: row.id,
    label: row.label,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
  };
}
