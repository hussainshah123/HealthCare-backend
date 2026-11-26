import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { OrderStatus } from '../generated/prisma/enums.js';

export type OrderActor = 'PHARMACY' | 'RIDER' | 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

/**
 * Every allowed status change and who may make it. The backend is the only
 * place statuses change; clients cannot jump to a later status.
 */
const TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, OrderActor[]>>> = {
  PENDING: {
    CONFIRMED: ['PHARMACY'],
    CANCELLED: ['PHARMACY', 'CUSTOMER', 'ADMIN'],
  },
  PRESCRIPTION_UNDER_REVIEW: {
    CONFIRMED: ['PHARMACY'],
    CANCELLED: ['PHARMACY', 'CUSTOMER', 'ADMIN'],
  },
  CONFIRMED: {
    PREPARING: ['PHARMACY'],
    CANCELLED: ['PHARMACY', 'CUSTOMER', 'ADMIN'],
  },
  PREPARING: {
    READY_FOR_PICKUP: ['PHARMACY'],
    CANCELLED: ['PHARMACY', 'CUSTOMER', 'ADMIN'],
  },
  READY_FOR_PICKUP: {
    RIDER_ASSIGNED: ['RIDER', 'ADMIN'],
    CANCELLED: ['PHARMACY', 'CUSTOMER', 'ADMIN'],
  },
  RIDER_ASSIGNED: {
    PICKED_UP: ['RIDER'],
    // the rider gives the job back, or an admin re-dispatches
    READY_FOR_PICKUP: ['RIDER', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
  },
  PICKED_UP: {
    ON_THE_WAY: ['RIDER'],
    CANCELLED: ['ADMIN'],
  },
  ON_THE_WAY: {
    DELIVERED: ['RIDER'],
    CANCELLED: ['ADMIN'],
  },
  DELIVERED: {
    RETURNED: ['ADMIN'],
  },
  CANCELLED: {},
  RETURNED: {},
};

export function canTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  if (actor === 'SYSTEM') return to in TRANSITIONS[from];
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Statuses during which a rider is attached and the customer may track them. */
export const TRACKABLE_STATUSES: OrderStatus[] = ['RIDER_ASSIGNED', 'PICKED_UP', 'ON_THE_WAY'];

/** Statuses in which stock is held for the order (released on cancel). */
export const STOCK_HELD_STATUSES: OrderStatus[] = [
  'PENDING',
  'PRESCRIPTION_UNDER_REVIEW',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'RIDER_ASSIGNED',
];

/**
 * Moves an order from `from` to `to` inside a transaction, recording history.
 * The update is conditional on the current status, so two concurrent changes
 * cannot both succeed: the loser gets a 409.
 */
export async function applyOrderTransition(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    actor: OrderActor;
    actorId: string | null;
    note?: string;
    data?: Prisma.OrderUpdateManyMutationInput;
  },
) {
  if (!canTransition(args.from, args.to, args.actor)) {
    throw new ConflictException(`Order cannot move from ${args.from} to ${args.to}`);
  }
  const { count } = await tx.order.updateMany({
    where: { id: args.orderId, status: args.from },
    data: { ...args.data, status: args.to },
  });
  if (count === 0) {
    throw new ConflictException('Order status changed in the meantime; reload and try again');
  }
  await tx.orderStatusHistory.create({
    data: { orderId: args.orderId, status: args.to, note: args.note, changedById: args.actorId },
  });
}
