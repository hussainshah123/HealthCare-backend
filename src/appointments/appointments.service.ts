import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AuthUser } from '../auth/auth-user.js';
import { Events, type AppointmentUpdatedEvent, type NotifyEvent } from '../common/events.js';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated } from '../common/pagination.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { findSlot, platformOffsetMinutes, slotKey } from '../doctors/slots.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AppointmentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { appointmentInclude, toAppointment, type AppointmentRow } from './appointment.mapper.js';
import type { CreateAppointmentDto, ListAppointmentsQueryDto } from './dto/appointment.dto.js';

/** How long before the start a customer may still cancel. */
const CUSTOMER_CANCEL_CUTOFF_MS = 60 * 60_000;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async book(customerId: string, dto: CreateAppointmentDto) {
    const doctor = await this.prisma.doctorProfile.findFirst({
      where: { userId: dto.doctorId, user: { status: 'ACTIVE' } },
      include: { availability: true },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');

    const startsAt = new Date(dto.startsAt);
    if (startsAt.getTime() <= Date.now()) throw new BadRequestException('Choose a time in the future');
    const slot = findSlot(startsAt, doctor.availability, platformOffsetMinutes());
    if (!slot) throw new BadRequestException('The doctor is not available at this time');

    let row: AppointmentRow;
    try {
      // The unique slotKey is the lock: two customers booking the same slot at once → one gets 409.
      row = await this.prisma.appointment.create({
        data: {
          doctorId: doctor.userId,
          customerId,
          type: dto.type,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          fee: doctor.fee,
          reason: dto.reason,
          slotKey: slotKey(doctor.userId, slot.startsAt),
          payments: toMoney(doctor.fee) > 0
            ? { create: { userId: customerId, amount: doctor.fee, method: 'ONLINE' } }
            : undefined,
        },
        include: appointmentInclude,
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This slot was just booked; please pick another');
      throw error;
    }

    this.emit(row);
    this.notify(row.doctorId, 'appointment.requested', 'New appointment request', `${row.customer.name} requested ${formatTime(row.startsAt)}`, row.id);
    return toAppointment(row);
  }

  async listMine(user: AuthUser, query: ListAppointmentsQueryDto) {
    const where: Prisma.AppointmentWhereInput = {
      ...(user.role === 'DOCTOR' ? { doctorId: user.id } : { customerId: user.id }),
      status: query.status,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({ where, include: appointmentInclude, orderBy: { startsAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.appointment.count({ where }),
    ]);
    return paginated(rows.map(toAppointment), total, query);
  }

  async findOne(user: AuthUser, id: string) {
    const row = await this.prisma.appointment.findUnique({ where: { id }, include: appointmentInclude });
    if (!row || !isParticipant(user, row)) throw new NotFoundException('Appointment not found');
    return toAppointment(row);
  }

  async accept(doctor: AuthUser, id: string) {
    if (doctor.status !== 'ACTIVE') throw new ForbiddenException('Your profile must be approved before accepting appointments');
    const row = await this.move(id, { doctorId: doctor.id }, ['REQUESTED'], 'CONFIRMED');
    this.notify(row.customerId, 'appointment.confirmed', 'Appointment confirmed', `Dr. ${row.doctor.user.name} confirmed ${formatTime(row.startsAt)}`, row.id);
    return toAppointment(row);
  }

  async reject(doctor: AuthUser, id: string, reason?: string) {
    const row = await this.move(id, { doctorId: doctor.id }, ['REQUESTED'], 'REJECTED', reason);
    this.notify(row.customerId, 'appointment.rejected', 'Appointment declined', reason ?? `Dr. ${row.doctor.user.name} could not take this appointment`, row.id);
    return toAppointment(row);
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    const current = await this.prisma.appointment.findUnique({ where: { id } });
    if (!current || !(current.customerId === user.id || current.doctorId === user.id)) {
      throw new NotFoundException('Appointment not found');
    }
    if (user.role === 'CUSTOMER' && current.startsAt.getTime() - Date.now() < CUSTOMER_CANCEL_CUTOFF_MS) {
      throw new BadRequestException('Appointments can be cancelled up to 1 hour before they start');
    }
    const owner = user.role === 'DOCTOR' ? { doctorId: user.id } : { customerId: user.id };
    const row = await this.move(id, owner, ['REQUESTED', 'CONFIRMED'], 'CANCELLED', reason ?? `Cancelled by ${user.role.toLowerCase()}`);
    const other = user.role === 'DOCTOR' ? row.customerId : row.doctorId;
    this.notify(other, 'appointment.cancelled', 'Appointment cancelled', `${formatTime(row.startsAt)} was cancelled`, row.id);
    return toAppointment(row);
  }

  /** Conditional status change; releases the slot lock when the appointment no longer holds it. */
  private async move(
    id: string,
    owner: Prisma.AppointmentWhereInput,
    from: AppointmentStatus[],
    to: AppointmentStatus,
    reason?: string,
  ) {
    const releasesSlot = to === 'CANCELLED' || to === 'REJECTED';
    const { count } = await this.prisma.appointment.updateMany({
      where: { id, ...owner, status: { in: from } },
      data: { status: to, ...(releasesSlot ? { slotKey: null, cancelReason: reason } : {}) },
    });
    if (count === 0) {
      const exists = await this.prisma.appointment.count({ where: { id, ...owner } });
      if (!exists) throw new NotFoundException('Appointment not found');
      throw new ConflictException(`Appointment cannot be moved to ${to} from its current status`);
    }
    const row = await this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
    this.emit(row);
    return row;
  }

  private emit(row: AppointmentRow) {
    this.events.emit(Events.AppointmentUpdated, {
      appointmentId: row.id,
      doctorId: row.doctorId,
      customerId: row.customerId,
      status: row.status,
    } satisfies AppointmentUpdatedEvent);
  }

  private notify(userId: string, type: string, title: string, body: string, appointmentId: string) {
    this.events.emit(Events.Notify, { userId, type, title, body, data: { appointmentId } } satisfies NotifyEvent);
  }
}

export function isParticipant(user: AuthUser, a: { customerId: string; doctorId: string }) {
  return user.role === 'ADMIN' || a.customerId === user.id || a.doctorId === user.id;
}

function formatTime(d: Date) {
  const local = new Date(d.getTime() + platformOffsetMinutes() * 60_000);
  return local.toISOString().slice(0, 16).replace('T', ' ');
}
