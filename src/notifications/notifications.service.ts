import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Events,
  type AppointmentUpdatedEvent,
  type NotifyEvent,
  type OrderStatusChangedEvent,
} from '../common/events.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import type { Notification, Prisma } from '../generated/prisma/client.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationResponseDto, RegisterDeviceTokenDto } from './dto/notification.dto.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { PushService } from './push.service.js';

/** What the customer is told at each order status. */
const ORDER_MESSAGES: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'Your order was confirmed by the pharmacy.',
  PREPARING: 'The pharmacy is preparing your order.',
  READY_FOR_PICKUP: 'Your order is packed and waiting for a rider.',
  RIDER_ASSIGNED: 'A rider has been assigned. You can track them live.',
  PICKED_UP: 'The rider picked up your order.',
  ON_THE_WAY: 'Your order is on the way.',
  DELIVERED: 'Your order was delivered. Get well soon!',
  CANCELLED: 'Your order was cancelled.',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly push: PushService,
  ) {}

  async list(userId: string, query: PaginationQueryDto) {
    const where = { userId };
    const [rows, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { ...paginated(rows.map(toResponse), total, query), unread };
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0 && !(await this.prisma.notification.count({ where: { id, userId } }))) {
      throw new NotFoundException('Notification not found');
    }
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async registerDevice(userId: string, dto: RegisterDeviceTokenDto) {
    // A token moves to whoever signed in on the device last.
    await this.prisma.deviceToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId, platform: dto.platform },
    });
    return { ok: true };
  }

  /** Stores a notification, pushes it in-app (socket) and to devices (FCM). Never throws: events are fire-and-forget. */
  @OnEvent(Events.Notify, { async: true })
  async onNotify(event: NotifyEvent) {
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId: event.userId,
          type: event.type,
          title: event.title,
          body: event.body,
          data: event.data as Prisma.InputJsonValue | undefined,
        },
      });
      this.gateway.sendToUser(event.userId, 'notification', toResponse(row));
      await this.push.send(event.userId, event.title, event.body, event.data);
    } catch (error) {
      this.logger.error(`Failed to deliver notification to ${event.userId}`, error as Error);
    }
  }

  @OnEvent(Events.OrderStatusChanged, { async: true })
  async onOrderStatus(event: OrderStatusChangedEvent) {
    this.gateway.sendToUser(event.customerId, 'order:updated', { orderId: event.orderId, status: event.status });
    this.gateway.sendToUser(event.pharmacyId, 'order:updated', { orderId: event.orderId, status: event.status });
    const body = ORDER_MESSAGES[event.status];
    if (body) {
      await this.onNotify({
        userId: event.customerId,
        type: 'order.status',
        title: `Order ${event.orderNumber}`,
        body,
        data: { orderId: event.orderId, status: event.status },
      });
    }
  }

  @OnEvent(Events.AppointmentUpdated)
  onAppointment(event: AppointmentUpdatedEvent) {
    const payload = { appointmentId: event.appointmentId, status: event.status };
    this.gateway.sendToUser(event.customerId, 'appointment:updated', payload);
    this.gateway.sendToUser(event.doctorId, 'appointment:updated', payload);
  }
}

function toResponse(n: Notification): NotificationResponseDto {
  return { id: n.id, type: n.type, title: n.title, body: n.body, data: n.data, readAt: n.readAt, createdAt: n.createdAt };
}
