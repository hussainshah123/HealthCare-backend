import type { Prisma } from '../generated/prisma/client.js';
import { toMoney } from '../common/money.js';
import type { OrderResponseDto } from './dto/order.dto.js';
import { TRACKABLE_STATUSES } from './order-status.js';

export const orderInclude = {
  items: true,
  history: { orderBy: { createdAt: 'asc' } },
  pharmacy: { select: { userId: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
  deliveries: {
    orderBy: { assignedAt: 'desc' },
    take: 1,
    include: { rider: { select: { user: { select: { name: true, phone: true } } } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function toOrderResponse(
  order: OrderWithRelations,
  viewer: 'CUSTOMER' | 'PHARMACY' | 'ADMIN',
): OrderResponseDto {
  const delivery = order.deliveries[0];
  const response: OrderResponseDto = {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: toMoney(order.subtotal),
    deliveryFee: toMoney(order.deliveryFee),
    discount: toMoney(order.discount),
    total: toMoney(order.total),
    items: order.items.map((i) => ({
      medicineId: i.medicineId,
      name: i.name,
      price: toMoney(i.price),
      quantity: i.quantity,
    })),
    address: order.address,
    pharmacy: { id: order.pharmacy.userId, name: order.pharmacy.name },
    customer: { id: order.customer.id, name: order.customer.name, phone: order.customer.phone },
    prescriptionId: order.prescriptionId,
    cancelReason: order.cancelReason,
    history: order.history.map((h) => ({ status: h.status, note: h.note, createdAt: h.createdAt })),
    delivery: delivery
      ? {
          id: delivery.id,
          status: delivery.status,
          riderId: delivery.riderId,
          riderName: delivery.rider.user.name,
          riderPhone: delivery.rider.user.phone,
          assignedAt: delivery.assignedAt,
          pickedUpAt: delivery.pickedUpAt,
          deliveredAt: delivery.deliveredAt,
        }
      : null,
    createdAt: order.createdAt,
  };
  // The customer reads the OTP to the rider at the door; nobody else sees it.
  if (viewer === 'CUSTOMER' && TRACKABLE_STATUSES.includes(order.status)) {
    response.deliveryOtp = order.deliveryOtp;
  }
  return response;
}
