import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { Events, type DeliveryStatusChangedEvent, type OrderStatusChangedEvent } from '../common/events.js';
import { roundMoney, toMoney } from '../common/money.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { restock } from '../prescriptions/prescriptions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  CancelOrderDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from './dto/order.dto.js';
import { orderInclude, toOrderResponse } from './order.mapper.js';
import { applyOrderTransition, STOCK_HELD_STATUSES, type OrderActor } from './order-status.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Checkout: turns the customer's cart into an order, holding stock for it. */
  async create(customerId: string, dto: CreateOrderDto) {
    const settings = await this.settings.get();
    const cart = await this.prisma.cartItem.findMany({
      where: { customerId },
      include: { medicine: { select: { name: true, requiresPrescription: true } } },
    });
    if (cart.length === 0) throw new BadRequestException('Your cart is empty');
    const pharmacyId = cart[0].pharmacyId;

    const address = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId: customerId } });
    if (!address) throw new NotFoundException('Address not found');
    const served = settings.serviceCities.map((c) => c.toLowerCase());
    if (served.length && !served.includes(address.city.toLowerCase())) {
      throw new BadRequestException(`We do not deliver to ${address.city} yet`);
    }

    const needsPrescription = cart.some((i) => i.medicine.requiresPrescription);
    if (needsPrescription) {
      if (!dto.prescriptionId) {
        throw new BadRequestException('A prescription is required for one or more items in your cart');
      }
      const prescription = await this.prisma.prescription.findFirst({
        where: { id: dto.prescriptionId, customerId },
      });
      if (!prescription) throw new NotFoundException('Prescription not found');
      if (prescription.status === 'REJECTED') {
        throw new BadRequestException('This prescription was rejected; please upload a new one');
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const pharmacy = await tx.pharmacyProfile.findUnique({
        where: { userId: pharmacyId },
        include: { user: { select: { status: true } } },
      });
      if (!pharmacy || pharmacy.user.status !== 'ACTIVE') {
        throw new BadRequestException('This pharmacy is not accepting orders');
      }

      let subtotal = 0;
      const items: Prisma.OrderItemCreateWithoutOrderInput[] = [];
      for (const line of cart) {
        const inv = await tx.pharmacyInventory.findUnique({
          where: { pharmacyId_medicineId: { pharmacyId, medicineId: line.medicineId } },
        });
        // Conditional decrement: never sells stock that another order took first.
        const { count } = await tx.pharmacyInventory.updateMany({
          where: { pharmacyId, medicineId: line.medicineId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (!inv || count === 0) {
          throw new ConflictException(`${line.medicine.name} is out of stock for the quantity requested`);
        }
        const price = toMoney(inv.price);
        subtotal += price * line.quantity;
        items.push({
          medicine: { connect: { id: line.medicineId } },
          name: line.medicine.name,
          price,
          quantity: line.quantity,
        });
      }
      subtotal = roundMoney(subtotal);
      const discount = await this.discountFor(tx, dto.couponCode, subtotal);
      const deliveryFee = settings.deliveryFee;
      const total = roundMoney(subtotal - discount + deliveryFee);
      const status: OrderStatus = needsPrescription ? 'PRESCRIPTION_UNDER_REVIEW' : 'PENDING';

      const created = await tx.order.create({
        data: {
          orderNumber: newOrderNumber(),
          customerId,
          pharmacyId,
          address: {
            label: address.label,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            lat: address.lat,
            lng: address.lng,
          },
          status,
          paymentMethod: dto.paymentMethod,
          subtotal,
          deliveryFee,
          discount,
          total,
          couponCode: discount > 0 ? dto.couponCode : undefined,
          prescriptionId: needsPrescription ? dto.prescriptionId : undefined,
          deliveryOtp: String(randomInt(1000, 10000)),
          items: { create: items },
          history: { create: { status, note: 'Order placed', changedById: customerId } },
          payments: {
            create: {
              userId: customerId,
              amount: total,
              method: dto.paymentMethod,
            },
          },
        },
        include: orderInclude,
      });
      await tx.cartItem.deleteMany({ where: { customerId } });
      return created;
    });

    this.emitStatus(order);
    this.events.emit(Events.Notify, {
      userId: pharmacyId,
      type: 'order.new',
      title: 'New order',
      body: `Order ${order.orderNumber}${needsPrescription ? ' needs prescription review' : ''}`,
      data: { orderId: order.id },
    });
    return toOrderResponse(order, 'CUSTOMER');
  }

  async listMine(customerId: string, query: PaginationQueryDto) {
    const where = { customerId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map((o) => toOrderResponse(o, 'CUSTOMER')), total, query);
  }

  async listForPharmacy(pharmacyId: string, query: ListOrdersQueryDto) {
    const where: Prisma.OrderWhereInput = { pharmacyId, status: query.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.order.count({ where }),
    ]);
    return paginated(rows.map((o) => toOrderResponse(o, 'PHARMACY')), total, query);
  }

  /** Customers see their own orders, pharmacies theirs, admins all; anyone else gets 404. */
  async findOne(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException('Order not found');
    if (user.role === 'ADMIN') return toOrderResponse(order, 'ADMIN');
    if (user.role === 'CUSTOMER' && order.customerId === user.id) return toOrderResponse(order, 'CUSTOMER');
    if (user.role === 'PHARMACY' && order.pharmacyId === user.id) return toOrderResponse(order, 'PHARMACY');
    throw new NotFoundException('Order not found');
  }

  async cancelByCustomer(customerId: string, id: string, dto: CancelOrderDto) {
    const order = await this.prisma.order.findFirst({ where: { id, customerId } });
    if (!order) throw new NotFoundException('Order not found');
    return this.cancel(order.id, order.status, 'CUSTOMER', customerId, dto.reason ?? 'Cancelled by customer');
  }

  /** Pharmacy moves its order forward (or cancels it). */
  async updateStatusByPharmacy(pharmacy: AuthUser, id: string, dto: UpdateOrderStatusDto) {
    if (pharmacy.status !== 'ACTIVE') {
      throw new ForbiddenException('Your pharmacy must be approved before processing orders');
    }
    const order = await this.prisma.order.findFirst({
      where: { id, pharmacyId: pharmacy.id },
      include: { prescription: { select: { status: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (dto.status === 'CANCELLED') {
      return this.cancel(order.id, order.status, 'PHARMACY', pharmacy.id, dto.note ?? 'Cancelled by pharmacy');
    }
    if (order.status === 'PRESCRIPTION_UNDER_REVIEW' && order.prescription?.status !== 'APPROVED') {
      throw new ConflictException('Review and approve the prescription before confirming this order');
    }

    await this.prisma.$transaction((tx) =>
      applyOrderTransition(tx, {
        orderId: order.id,
        from: order.status,
        to: dto.status,
        actor: 'PHARMACY',
        actorId: pharmacy.id,
        note: dto.note,
      }),
    );
    return this.reloadAndEmit(order.id, 'PHARMACY');
  }

  /** Re-fills the cart from a past order with what is still in stock. */
  async reorder(customerId: string, id: string) {
    const order = await this.prisma.order.findFirst({ where: { id, customerId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    const added: string[] = [];
    const skipped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { customerId } });
      for (const item of order.items) {
        const inv = await tx.pharmacyInventory.findUnique({
          where: { pharmacyId_medicineId: { pharmacyId: order.pharmacyId, medicineId: item.medicineId } },
        });
        if (!inv || inv.stock < 1) {
          skipped.push(item.name);
          continue;
        }
        await tx.cartItem.create({
          data: {
            customerId,
            medicineId: item.medicineId,
            pharmacyId: order.pharmacyId,
            quantity: Math.min(item.quantity, inv.stock),
          },
        });
        added.push(item.name);
      }
    });
    return { added, skipped };
  }

  /**
   * Cancels an order: releases held stock and ends any active delivery.
   * Used by customers, pharmacies and admins (each limited by the transition table).
   */
  async cancel(orderId: string, from: OrderStatus, actor: OrderActor, actorId: string, reason: string) {
    const endedDelivery = await this.prisma.$transaction(async (tx) => {
      await applyOrderTransition(tx, {
        orderId,
        from,
        to: 'CANCELLED',
        actor,
        actorId,
        note: reason,
        data: { cancelReason: reason },
      });
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (STOCK_HELD_STATUSES.includes(from)) await restock(tx, orderId, order.pharmacyId);
      const active = await tx.delivery.findUnique({ where: { activeOrderId: orderId } });
      if (active) {
        await tx.delivery.update({
          where: { id: active.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), activeOrderId: null },
        });
      }
      return active;
    });

    if (endedDelivery) {
      this.events.emit(Events.DeliveryStatusChanged, {
        deliveryId: endedDelivery.id,
        orderId,
        riderId: endedDelivery.riderId,
        status: 'CANCELLED',
        ended: true,
      } satisfies DeliveryStatusChangedEvent);
    }
    return this.reloadAndEmit(orderId, actor === 'CUSTOMER' ? 'CUSTOMER' : actor === 'PHARMACY' ? 'PHARMACY' : 'ADMIN');
  }

  private async reloadAndEmit(orderId: string, viewer: 'CUSTOMER' | 'PHARMACY' | 'ADMIN') {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    this.emitStatus(order);
    return toOrderResponse(order, viewer);
  }

  private emitStatus(order: { id: string; orderNumber: string; customerId: string; pharmacyId: string; status: OrderStatus }) {
    this.events.emit(Events.OrderStatusChanged, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      pharmacyId: order.pharmacyId,
      status: order.status,
    } satisfies OrderStatusChangedEvent);
  }

  private async discountFor(tx: Prisma.TransactionClient, code: string | undefined, subtotal: number) {
    if (!code) return 0;
    const coupon = await tx.coupon.findUnique({ where: { code: code.toUpperCase() } });
    if (!coupon || !coupon.active || (coupon.expiresAt && coupon.expiresAt < new Date())) {
      throw new BadRequestException('Coupon is invalid or expired');
    }
    let discount = (subtotal * coupon.percentOff) / 100;
    if (coupon.maxDiscount) discount = Math.min(discount, toMoney(coupon.maxDiscount));
    return roundMoney(Math.min(discount, subtotal));
  }
}

/** e.g. HC-261124-4F7K2Q: date plus 6 random base-36 characters (unique index backs it). */
function newOrderNumber() {
  const d = new Date();
  const date = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[randomInt(36)];
  return `HC-${date}-${suffix}`;
}
