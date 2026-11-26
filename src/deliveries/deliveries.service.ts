import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { timingSafeEqual } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import {
  Events,
  type DeliveryStatusChangedEvent,
  type OrderStatusChangedEvent,
  type RiderLocationUpdatedEvent,
} from '../common/events.js';
import { roundMoney, toMoney } from '../common/money.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DeliveryStatus, OrderStatus } from '../generated/prisma/enums.js';
import { applyOrderTransition, TRACKABLE_STATUSES, type OrderActor } from '../orders/order-status.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  AvailableDeliveryDto,
  DeliveryResponseDto,
  LocationPointDto,
  LocationUpdateDto,
  TrackingResponseDto,
} from './dto/delivery.dto.js';

const deliveryInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      address: true,
      customerId: true,
      pharmacyId: true,
      customer: { select: { name: true, phone: true } },
      pharmacy: { select: { name: true, address: true, lat: true, lng: true } },
    },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof deliveryInclude }>;
type AddressSnapshot = { line1: string; city: string; lat: number | null; lng: number | null };

/** Each rider step: the delivery status it needs, the one it sets, and the matching order statuses. */
const STEPS = {
  pickup: { from: 'ASSIGNED', to: 'PICKED_UP', orderFrom: 'RIDER_ASSIGNED', orderTo: 'PICKED_UP', stamp: 'pickedUpAt' },
  start: { from: 'PICKED_UP', to: 'ON_THE_WAY', orderFrom: 'PICKED_UP', orderTo: 'ON_THE_WAY', stamp: 'startedAt' },
} as const;

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Orders waiting for a rider. Only approved riders who are online see them. */
  async available(rider: AuthUser): Promise<AvailableDeliveryDto[]> {
    await this.requireOnlineRider(rider);
    const settings = await this.settings.get();
    const orders = await this.prisma.order.findMany({
      where: { status: 'READY_FOR_PICKUP', deliveries: { none: { activeOrderId: { not: null } } } },
      orderBy: { updatedAt: 'asc' },
      take: 50,
      include: { pharmacy: { select: { name: true, address: true, lat: true, lng: true } } },
    });
    return orders.map((o) => {
      const address = o.address as AddressSnapshot;
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        fee: riderFee(toMoney(o.deliveryFee), settings.riderFeePercent),
        pharmacy: o.pharmacy,
        dropoff: { city: address.city, lat: address.lat, lng: address.lng },
        readyAt: o.updatedAt,
      };
    });
  }

  async accept(rider: AuthUser, orderId: string): Promise<DeliveryResponseDto> {
    await this.requireOnlineRider(rider);
    return this.assign(orderId, rider.id, 'RIDER', rider.id);
  }

  /** Admin/dispatch assigns a specific rider. */
  async assignByAdmin(admin: AuthUser, orderId: string, riderId: string): Promise<DeliveryResponseDto> {
    const rider = await this.prisma.user.findFirst({
      where: { id: riderId, role: 'RIDER', status: 'ACTIVE' },
      include: { riderProfile: { select: { isOnline: true } } },
    });
    if (!rider) throw new NotFoundException('Approved rider not found');
    return this.assign(orderId, riderId, 'ADMIN', admin.id);
  }

  async active(riderId: string): Promise<DeliveryResponseDto | null> {
    const row = await this.prisma.delivery.findFirst({
      where: { riderId, activeOrderId: { not: null } },
      include: deliveryInclude,
    });
    return row ? toDelivery(row) : null;
  }

  async history(riderId: string, query: PaginationQueryDto) {
    const where: Prisma.DeliveryWhereInput = { riderId, status: { in: ['DELIVERED', 'CANCELLED'] } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.delivery.findMany({ where, include: deliveryInclude, orderBy: { assignedAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.delivery.count({ where }),
    ]);
    return paginated(rows.map(toDelivery), total, query);
  }

  /** The rider hands the job back before pickup; the order returns to the pickup queue. */
  async reject(rider: AuthUser, deliveryId: string) {
    const delivery = await this.ownActiveDelivery(rider.id, deliveryId);
    if (delivery.status !== 'ASSIGNED') throw new ConflictException('You can only give back a delivery before pickup');
    await this.prisma.$transaction(async (tx) => {
      await this.moveDelivery(tx, delivery.id, 'ASSIGNED', {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        activeOrderId: null,
      });
      await applyOrderTransition(tx, {
        orderId: delivery.orderId,
        from: 'RIDER_ASSIGNED',
        to: 'READY_FOR_PICKUP',
        actor: 'RIDER',
        actorId: rider.id,
        note: 'Rider released the delivery',
      });
    });
    this.emitDelivery(delivery, 'CANCELLED', true);
    await this.emitOrder(delivery.orderId);
    return { ok: true };
  }

  pickup(rider: AuthUser, deliveryId: string) {
    return this.step(rider, deliveryId, STEPS.pickup);
  }

  start(rider: AuthUser, deliveryId: string) {
    return this.step(rider, deliveryId, STEPS.start);
  }

  /** Delivery is complete only when the rider enters the customer's one-time code. */
  async complete(rider: AuthUser, deliveryId: string, otp: string) {
    const delivery = await this.ownActiveDelivery(rider.id, deliveryId);
    if (delivery.status !== 'ON_THE_WAY') throw new ConflictException('Start the trip before completing the delivery');
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: delivery.orderId } });
    if (!sameCode(otp, order.deliveryOtp)) throw new BadRequestException('Incorrect delivery code');

    await this.prisma.$transaction(async (tx) => {
      await this.moveDelivery(tx, delivery.id, 'ON_THE_WAY', {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        activeOrderId: null,
      });
      await applyOrderTransition(tx, {
        orderId: order.id,
        from: 'ON_THE_WAY',
        to: 'DELIVERED',
        actor: 'RIDER',
        actorId: rider.id,
        note: 'Delivered (OTP verified)',
        // Cash collected at the door.
        data: order.paymentMethod === 'COD' ? { paymentStatus: 'PAID' } : undefined,
      });
      if (order.paymentMethod === 'COD') {
        await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'PAID' } });
      }
    });
    this.emitDelivery(delivery, 'DELIVERED', true);
    await this.emitOrder(order.id);
    return this.toResponse(delivery.id);
  }

  /** Stores a GPS point for the rider's active delivery and broadcasts it to the customer's tracking room. */
  async recordLocation(rider: AuthUser, deliveryId: string, dto: LocationUpdateDto): Promise<LocationPointDto> {
    if (rider.role !== 'RIDER') throw new ForbiddenException();
    const delivery = await this.ownActiveDelivery(rider.id, deliveryId);
    const point = await this.prisma.$transaction(async (tx) => {
      const row = await tx.riderLocation.create({
        data: {
          riderId: rider.id,
          deliveryId: delivery.id,
          lat: dto.lat,
          lng: dto.lng,
          heading: dto.heading,
          speed: dto.speed,
        },
      });
      await tx.riderProfile.update({
        where: { userId: rider.id },
        data: { lastLat: dto.lat, lastLng: dto.lng, lastSeenAt: row.recordedAt },
      });
      return row;
    });
    this.events.emit(Events.RiderLocationUpdated, {
      orderId: delivery.orderId,
      deliveryId: delivery.id,
      lat: point.lat,
      lng: point.lng,
      heading: point.heading,
      speed: point.speed,
      recordedAt: point.recordedAt.toISOString(),
    } satisfies RiderLocationUpdatedEvent);
    return toPoint(point);
  }

  /** Customer's tracking screen. Available only while a rider is attached to the order. */
  async tracking(user: AuthUser, orderId: string): Promise<TrackingResponseDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    const allowed = order && (user.role === 'ADMIN' || order.customerId === user.id);
    if (!order || !allowed) throw new NotFoundException('Order not found');
    if (!TRACKABLE_STATUSES.includes(order.status)) {
      throw new ConflictException('Live tracking is available once a rider is assigned and until delivery');
    }
    const delivery = await this.prisma.delivery.findUnique({
      where: { activeOrderId: orderId },
      include: {
        ...deliveryInclude,
        rider: { select: { vehicleNumber: true, user: { select: { name: true, phone: true, avatarUrl: true } } } },
      },
    });
    if (!delivery) throw new ConflictException('No active delivery for this order');
    const last = await this.lastLocation(delivery.id);
    const address = delivery.order.address as AddressSnapshot;
    return {
      delivery: toDelivery(delivery),
      rider: {
        name: delivery.rider.user.name,
        phone: delivery.rider.user.phone,
        avatarUrl: delivery.rider.user.avatarUrl,
        vehicleNumber: delivery.rider.vehicleNumber,
      },
      lastLocation: last,
      destination: { lat: address.lat, lng: address.lng, line1: address.line1 },
      pharmacy: {
        lat: delivery.order.pharmacy.lat,
        lng: delivery.order.pharmacy.lng,
        name: delivery.order.pharmacy.name,
      },
    };
  }

  /** Used by the tracking gateway: may this user watch this order, and where is the rider now? */
  async canWatch(user: AuthUser, orderId: string): Promise<{ allowed: boolean; lastLocation: LocationPointDto | null }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true, status: true } });
    const allowed =
      !!order &&
      (user.role === 'ADMIN' || (order.customerId === user.id && TRACKABLE_STATUSES.includes(order.status)));
    if (!allowed) return { allowed: false, lastLocation: null };
    const delivery = await this.prisma.delivery.findUnique({ where: { activeOrderId: orderId }, select: { id: true } });
    return { allowed: true, lastLocation: delivery ? await this.lastLocation(delivery.id) : null };
  }

  listActive() {
    return this.prisma.delivery
      .findMany({
        where: { activeOrderId: { not: null } },
        include: deliveryInclude,
        orderBy: { assignedAt: 'desc' },
      })
      .then((rows) => rows.map(toDelivery));
  }

  // ───────────────────────── internals ─────────────────────────

  private async assign(orderId: string, riderId: string, actor: OrderActor, actorId: string) {
    const settings = await this.settings.get();
    const busy = await this.prisma.delivery.count({ where: { riderId, activeOrderId: { not: null } } });
    if (busy) throw new ConflictException('Rider already has an active delivery');

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== 'READY_FOR_PICKUP') throw new ConflictException('Order is not waiting for a rider');

    let deliveryId: string;
    try {
      deliveryId = await this.prisma.$transaction(async (tx) => {
        await applyOrderTransition(tx, {
          orderId,
          from: 'READY_FOR_PICKUP',
          to: 'RIDER_ASSIGNED',
          actor,
          actorId,
          note: actor === 'ADMIN' ? 'Rider assigned by dispatch' : 'Rider accepted the delivery',
        });
        const created = await tx.delivery.create({
          data: {
            orderId,
            riderId,
            activeOrderId: orderId, // unique: a second concurrent assignment fails here
            fee: riderFee(toMoney(order.deliveryFee), settings.riderFeePercent),
          },
        });
        return created.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Another rider took this delivery');
      throw error;
    }

    const response = await this.toResponse(deliveryId);
    this.emitDelivery({ id: deliveryId, orderId, riderId }, 'ASSIGNED', false);
    await this.emitOrder(orderId);
    this.events.emit(Events.Notify, {
      userId: riderId,
      type: 'delivery.assigned',
      title: 'New delivery',
      body: `Order ${order.orderNumber} is assigned to you`,
      data: { deliveryId, orderId },
    });
    return response;
  }

  private async step(
    rider: AuthUser,
    deliveryId: string,
    step: (typeof STEPS)[keyof typeof STEPS],
  ) {
    const delivery = await this.ownActiveDelivery(rider.id, deliveryId);
    if (delivery.status !== step.from) {
      throw new ConflictException(`Delivery is ${delivery.status}; expected ${step.from}`);
    }
    await this.prisma.$transaction(async (tx) => {
      await this.moveDelivery(tx, delivery.id, step.from, { status: step.to, [step.stamp]: new Date() });
      await applyOrderTransition(tx, {
        orderId: delivery.orderId,
        from: step.orderFrom as OrderStatus,
        to: step.orderTo as OrderStatus,
        actor: 'RIDER',
        actorId: rider.id,
      });
    });
    this.emitDelivery(delivery, step.to, false);
    await this.emitOrder(delivery.orderId);
    return this.toResponse(delivery.id);
  }

  private async moveDelivery(
    tx: Prisma.TransactionClient,
    id: string,
    from: DeliveryStatus,
    data: Prisma.DeliveryUpdateManyMutationInput,
  ) {
    const { count } = await tx.delivery.updateMany({ where: { id, status: from }, data });
    if (count === 0) throw new ConflictException('Delivery changed in the meantime; reload and try again');
  }

  private async ownActiveDelivery(riderId: string, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, riderId, activeOrderId: { not: null } },
    });
    if (!delivery) throw new NotFoundException('Active delivery not found');
    return delivery;
  }

  private async requireOnlineRider(rider: AuthUser) {
    if (rider.status !== 'ACTIVE') throw new ForbiddenException('Your account is awaiting approval');
    const profile = await this.prisma.riderProfile.findUnique({ where: { userId: rider.id } });
    if (!profile?.isOnline) throw new ForbiddenException('Go online to receive deliveries');
  }

  private async lastLocation(deliveryId: string) {
    const row = await this.prisma.riderLocation.findFirst({
      where: { deliveryId },
      orderBy: { recordedAt: 'desc' },
    });
    return row ? toPoint(row) : null;
  }

  private async toResponse(id: string) {
    const row = await this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: deliveryInclude });
    return toDelivery(row);
  }

  private emitDelivery(d: { id: string; orderId: string; riderId: string }, status: DeliveryStatus, ended: boolean) {
    this.events.emit(Events.DeliveryStatusChanged, {
      deliveryId: d.id,
      orderId: d.orderId,
      riderId: d.riderId,
      status,
      ended,
    } satisfies DeliveryStatusChangedEvent);
  }

  private async emitOrder(orderId: string) {
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    this.events.emit(Events.OrderStatusChanged, {
      orderId: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customerId,
      pharmacyId: o.pharmacyId,
      status: o.status,
    } satisfies OrderStatusChangedEvent);
  }
}

export function riderFee(deliveryFee: number, riderFeePercent: number) {
  return roundMoney((deliveryFee * riderFeePercent) / 100);
}

/** Constant-time comparison so the code can't be guessed digit by digit from timing. */
function sameCode(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toPoint(row: { lat: number; lng: number; heading: number | null; speed: number | null; recordedAt: Date }) {
  return { lat: row.lat, lng: row.lng, heading: row.heading, speed: row.speed, recordedAt: row.recordedAt };
}

function toDelivery(row: DeliveryRow): DeliveryResponseDto {
  const address = row.order.address as AddressSnapshot;
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    status: row.status,
    fee: toMoney(row.fee),
    pharmacy: row.order.pharmacy,
    dropoff: { line1: address.line1, city: address.city, lat: address.lat, lng: address.lng },
    customerName: row.order.customer.name,
    customerPhone: row.order.customer.phone,
    assignedAt: row.assignedAt,
    pickedUpAt: row.pickedUpAt,
    deliveredAt: row.deliveredAt,
  };
}
