import type { Prisma } from '../generated/prisma/client.js';
import { toMoney } from '../common/money.js';
import type { AppointmentResponseDto } from './dto/appointment.dto.js';

export const appointmentInclude = {
  doctor: {
    select: {
      userId: true,
      specialization: { select: { name: true } },
      user: { select: { name: true, avatarUrl: true } },
    },
  },
  customer: { select: { id: true, name: true } },
  consultation: { select: { id: true } },
} satisfies Prisma.AppointmentInclude;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function toAppointment(a: AppointmentRow): AppointmentResponseDto {
  return {
    id: a.id,
    status: a.status,
    type: a.type,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    fee: toMoney(a.fee),
    reason: a.reason,
    cancelReason: a.cancelReason,
    doctor: {
      id: a.doctor.userId,
      name: a.doctor.user.name,
      specialization: a.doctor.specialization?.name ?? null,
      avatarUrl: a.doctor.user.avatarUrl,
    },
    customer: { id: a.customer.id, name: a.customer.name },
    consultationId: a.consultation?.id ?? null,
    createdAt: a.createdAt,
  };
}
