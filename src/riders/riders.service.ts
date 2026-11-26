import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { roundMoney, toMoney } from '../common/money.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  RiderAvailabilityDto,
  RiderEarningsResponseDto,
  RiderProfileResponseDto,
  UpdateRiderDto,
} from './dto/rider.dto.js';

@Injectable()
export class RidersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: string): Promise<RiderProfileResponseDto> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { riderProfile: true },
    });
    const p = user.riderProfile;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      avatarUrl: user.avatarUrl,
      vehicleType: p?.vehicleType ?? null,
      vehicleNumber: p?.vehicleNumber ?? null,
      licenseNumber: p?.licenseNumber ?? null,
      cnic: p?.cnic ?? null,
      online: p?.isOnline ?? false,
    };
  }

  async updateMine(userId: string, dto: UpdateRiderDto) {
    await this.prisma.riderProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    return this.getMine(userId);
  }

  async setAvailability(rider: AuthUser, dto: RiderAvailabilityDto) {
    if (dto.online && rider.status !== 'ACTIVE') {
      throw new ForbiddenException('Your account must be approved before you can go online');
    }
    if (!dto.online) {
      const active = await this.prisma.delivery.count({
        where: { riderId: rider.id, activeOrderId: { not: null } },
      });
      if (active) throw new ConflictException('Finish your active delivery before going offline');
    }
    await this.prisma.riderProfile.update({
      where: { userId: rider.id },
      data: { isOnline: dto.online, lastSeenAt: new Date() },
    });
    return this.getMine(rider.id);
  }

  async earnings(riderId: string): Promise<RiderEarningsResponseDto> {
    const rows = await this.prisma.delivery.findMany({
      where: { riderId, status: 'DELIVERED' },
      orderBy: { deliveredAt: 'desc' },
      include: { order: { select: { orderNumber: true } } },
    });
    const items = rows.map((d) => ({
      deliveryId: d.id,
      orderNumber: d.order.orderNumber,
      fee: toMoney(d.fee),
      deliveredAt: d.deliveredAt,
    }));
    return {
      total: roundMoney(items.reduce((sum, i) => sum + i.fee, 0)),
      deliveries: items.length,
      items,
    };
  }
}
