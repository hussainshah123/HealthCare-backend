import type { DeliveryStatus, OrderStatus } from '../generated/prisma/enums.js';

/** In-process domain events (via @nestjs/event-emitter). */
export const Events = {
  OrderStatusChanged: 'order.status-changed',
  DeliveryStatusChanged: 'delivery.status-changed',
  RiderLocationUpdated: 'rider.location-updated',
  AppointmentUpdated: 'appointment.updated',
  ConsultationEnded: 'consultation.ended',
  ConsultationMessage: 'consultation.message',
  Notify: 'notification.create',
} as const;

export interface OrderStatusChangedEvent {
  orderId: string;
  orderNumber: string;
  customerId: string;
  pharmacyId: string;
  status: OrderStatus;
}

export interface DeliveryStatusChangedEvent {
  deliveryId: string;
  orderId: string;
  riderId: string;
  status: DeliveryStatus;
  /** true when the delivery ended (delivered or cancelled): tracking stops. */
  ended: boolean;
}

export interface RiderLocationUpdatedEvent {
  orderId: string;
  deliveryId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
}

export interface AppointmentUpdatedEvent {
  appointmentId: string;
  doctorId: string;
  customerId: string;
  status: string;
}

export interface ConsultationEndedEvent {
  consultationId: string;
}

export interface ConsultationMessageEvent {
  consultationId: string;
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export interface NotifyEvent {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
