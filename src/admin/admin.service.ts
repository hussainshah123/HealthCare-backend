import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TokenService } from '@nestjs/authentication';
import { appointmentInclude, toAppointment } from '../appointments/appointment.mapper.js';
import type { AuthUser } from '../auth/auth-user.js';
import { Events, type NotifyEvent } from '../common/events.js';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { orderInclude, toOrderResponse } from '../orders/order.mapper.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AdminAppointmentsQueryDto,
  AdminOrdersQueryDto,
  AdminStatsDto,
  ListUsersQueryDto,
  UpdateUserStatusDto,
} from './dto/admin.dto.js';

const userListInclude = {
  doctorProfile: { include: { specialization: true } },
  riderProfile: true,
  pharmacyProfile: true,
  customerProfile: true,
} satisfies Prisma.UserInclude;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly events: EventEmitter2,
  ) {}

  async stats(): Promise<AdminStatsDto> {
    const [customers, doctors, riders, pharmacies, orders, activeDeliveries, consultations, revenue, pendingApprovals] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { role: 'CUSTOMER' } }),
        this.prisma.user.count({ where: { role: 'DOCTOR' } }),
        this.prisma.user.count({ where: { role: 'RIDER' } }),
        this.prisma.user.count({ where: { role: 'PHARMACY' } }),
        this.prisma.order.count(),
        this.prisma.delivery.count({ where: { activeOrderId: { not: null } } }),
        this.prisma.consultation.count(),
        this.prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
        this.prisma.user.count({ where: { status: 'PENDING' } }),
      ]);
    return {
      customers,
      doctors,
      riders,
      pharmacies,
      orders,
      activeDeliveries,
      consultations,
      revenue: toMoney(revenue._sum.amount),
      pendingApprovals,
    };
  }

  async listUsers(query: ListUsersQueryDto) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: userListInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.user.count({ where }),
    ]);
    const items = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
      profile: profileOf(u),
    }));
    return paginated(items, total, query);
  }

  /** Approve, reject or suspend an account. Suspension also signs the user out of every device. */
  async updateUserStatus(admin: AuthUser, id: string, dto: UpdateUserStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.id === admin.id) throw new BadRequestException('You cannot change your own status');

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { status: dto.status } }),
      ...(dto.status === 'SUSPENDED' && user.role === 'RIDER'
        ? [this.prisma.riderProfile.updateMany({ where: { userId: id }, data: { isOnline: false } })]
        : []),
      this.prisma.auditLog.create({
        data: {
          actorId: admin.id,
          action: `user.status.${dto.status.toLowerCase()}`,
          entity: 'user',
          entityId: id,
          data: { from: user.status, to: dto.status, note: dto.note ?? null },
        },
      }),
    ]);
    if (dto.status === 'SUSPENDED') await this.tokens.revokeAll(id);

    const titles = { ACTIVE: 'Account approved', REJECTED: 'Account not approved', SUSPENDED: 'Account suspended' };
    this.events.emit(Events.Notify, {
      userId: id,
      type: 'account.status',
      title: titles[dto.status],
      body: dto.note ?? (dto.status === 'ACTIVE' ? 'You can now start using the platform.' : 'Please contact support for details.'),
      data: { status: dto.status },
    } satisfies NotifyEvent);
    return { id, status: dto.status };
  }

  async listOrders(query: AdminOrdersQueryDto) {
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { name: { contains: query.search, mode: 'insensitive' } } },
              { customer: { phone: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map((o) => toOrderResponse(o, 'ADMIN')), total, query);
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException('Order not found');
    return toOrderResponse(order, 'ADMIN');
  }

  /** Approved riders who are online and free, with their last known position. */
  async onlineRiders() {
    const rows = await this.prisma.riderProfile.findMany({
      where: { isOnline: true, user: { status: 'ACTIVE' } },
      include: {
        user: { select: { name: true, phone: true } },
        deliveries: { where: { activeOrderId: { not: null } }, select: { id: true } },
      },
    });
    return rows.map((r) => ({
      id: r.userId,
      name: r.user.name,
      phone: r.user.phone,
      vehicleType: r.vehicleType,
      vehicleNumber: r.vehicleNumber,
      lastLat: r.lastLat,
      lastLng: r.lastLng,
      lastSeenAt: r.lastSeenAt,
      busy: r.deliveries.length > 0,
    }));
  }

  async listAppointments(query: AdminAppointmentsQueryDto) {
    const where: Prisma.AppointmentWhereInput = { status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include: appointmentInclude, orderBy: { startsAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(rows.map(toAppointment), total, query);
  }
}

function profileOf(u: Prisma.UserGetPayload<{ include: typeof userListInclude }>) {
  switch (u.role) {
    case 'DOCTOR':
      return u.doctorProfile && {
        specialization: u.doctorProfile.specialization?.name ?? null,
        qualifications: u.doctorProfile.qualifications,
        registrationNumber: u.doctorProfile.registrationNumber,
        experienceYears: u.doctorProfile.experienceYears,
        fee: toMoney(u.doctorProfile.fee),
      };
    case 'RIDER':
      return u.riderProfile && {
        vehicleType: u.riderProfile.vehicleType,
        vehicleNumber: u.riderProfile.vehicleNumber,
        licenseNumber: u.riderProfile.licenseNumber,
        cnic: u.riderProfile.cnic,
        isOnline: u.riderProfile.isOnline,
      };
    case 'PHARMACY':
      return u.pharmacyProfile && {
        name: u.pharmacyProfile.name,
        address: u.pharmacyProfile.address,
        city: u.pharmacyProfile.city,
        licenseNumber: u.pharmacyProfile.licenseNumber,
      };
    case 'CUSTOMER':
      return u.customerProfile && {
        dateOfBirth: u.customerProfile.dateOfBirth,
        gender: u.customerProfile.gender,
      };
    default:
      return null;
  }
}
