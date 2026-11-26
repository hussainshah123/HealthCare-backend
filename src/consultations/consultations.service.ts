import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import {
  Events,
  type AppointmentUpdatedEvent,
  type ConsultationEndedEvent,
  type ConsultationMessageEvent,
  type NotifyEvent,
} from '../common/events.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ConsultationResponseDto,
  CreateDoctorPrescriptionDto,
  DoctorPrescriptionResponseDto,
  MessageResponseDto,
} from './dto/consultation.dto.js';

/** A doctor may open the room this long before the appointment starts. */
const EARLY_START_MS = 15 * 60_000;

const consultationInclude = {
  prescription: { select: { id: true } },
  appointment: {
    select: {
      id: true,
      type: true,
      doctorId: true,
      customerId: true,
      doctor: { select: { user: { select: { name: true } } } },
      customer: { select: { name: true } },
    },
  },
} satisfies Prisma.ConsultationInclude;

type ConsultationRow = Prisma.ConsultationGetPayload<{ include: typeof consultationInclude }>;

const prescriptionInclude = {
  items: true,
  customer: { select: { id: true, name: true } },
  doctor: {
    select: {
      userId: true,
      registrationNumber: true,
      specialization: { select: { name: true } },
      user: { select: { name: true } },
    },
  },
} satisfies Prisma.DoctorPrescriptionInclude;

type PrescriptionRow = Prisma.DoctorPrescriptionGetPayload<{ include: typeof prescriptionInclude }>;

@Injectable()
export class ConsultationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** The doctor opens the consultation room for a confirmed appointment. Idempotent while it is open. */
  async start(doctor: AuthUser, appointmentId: string): Promise<ConsultationResponseDto> {
    if (doctor.status !== 'ACTIVE') throw new ForbiddenException('Your profile must be approved first');
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, doctorId: doctor.id },
      include: { consultation: true },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (appointment.consultation && appointment.consultation.status !== 'ENDED') {
      return this.toResponse(appointment.consultation.id);
    }
    if (appointment.status !== 'CONFIRMED') throw new ConflictException('Only confirmed appointments can be started');
    const now = Date.now();
    if (now < appointment.startsAt.getTime() - EARLY_START_MS) {
      throw new ConflictException('You can start the consultation up to 15 minutes before the appointment');
    }

    const consultation = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id: appointmentId, status: 'CONFIRMED' },
        data: { status: 'IN_PROGRESS' },
      });
      if (count === 0) throw new ConflictException('Appointment changed in the meantime');
      return tx.consultation.create({
        data: { appointmentId, status: 'ACTIVE', roomId: randomUUID(), startedAt: new Date() },
      });
    });

    this.events.emit(Events.AppointmentUpdated, {
      appointmentId,
      doctorId: appointment.doctorId,
      customerId: appointment.customerId,
      status: 'IN_PROGRESS',
    } satisfies AppointmentUpdatedEvent);
    this.events.emit(Events.Notify, {
      userId: appointment.customerId,
      type: 'consultation.started',
      title: 'Your doctor is ready',
      body: 'Join the consultation now',
      data: { consultationId: consultation.id, appointmentId },
    } satisfies NotifyEvent);
    return this.toResponse(consultation.id);
  }

  async get(user: AuthUser, id: string) {
    await this.requireParticipant(user, id);
    return this.toResponse(id);
  }

  async end(doctor: AuthUser, id: string) {
    const row = await this.requireParticipant(doctor, id);
    if (row.appointment.doctorId !== doctor.id) throw new ForbiddenException('Only the doctor can end the consultation');
    if (row.status === 'ENDED') return this.toResponse(id);

    await this.prisma.$transaction([
      this.prisma.consultation.update({ where: { id }, data: { status: 'ENDED', endedAt: new Date() } }),
      this.prisma.appointment.update({ where: { id: row.appointmentId }, data: { status: 'COMPLETED', slotKey: null } }),
    ]);
    this.events.emit(Events.ConsultationEnded, { consultationId: id } satisfies ConsultationEndedEvent);
    this.events.emit(Events.AppointmentUpdated, {
      appointmentId: row.appointmentId,
      doctorId: row.appointment.doctorId,
      customerId: row.appointment.customerId,
      status: 'COMPLETED',
    } satisfies AppointmentUpdatedEvent);
    return this.toResponse(id);
  }

  async messages(user: AuthUser, id: string): Promise<MessageResponseDto[]> {
    await this.requireParticipant(user, id);
    const rows = await this.prisma.consultationMessage.findMany({
      where: { consultationId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map((m) => ({ id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt }));
  }

  async sendMessage(user: AuthUser, id: string, body: string): Promise<MessageResponseDto> {
    const row = await this.requireParticipant(user, id);
    if (row.status === 'ENDED') throw new ConflictException('This consultation has ended');
    const m = await this.prisma.consultationMessage.create({ data: { consultationId: id, senderId: user.id, body } });
    this.events.emit(Events.ConsultationMessage, {
      consultationId: id,
      id: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    } satisfies ConsultationMessageEvent);
    const other = user.id === row.appointment.doctorId ? row.appointment.customerId : row.appointment.doctorId;
    this.events.emit(Events.Notify, {
      userId: other,
      type: 'consultation.message',
      title: `Message from ${user.name}`,
      body: body.slice(0, 120),
      data: { consultationId: id },
    } satisfies NotifyEvent);
    return { id: m.id, senderId: m.senderId, body: m.body, createdAt: m.createdAt };
  }

  /** The doctor issues one structured prescription per consultation. */
  async prescribe(doctor: AuthUser, id: string, dto: CreateDoctorPrescriptionDto): Promise<DoctorPrescriptionResponseDto> {
    const row = await this.requireParticipant(doctor, id);
    if (row.appointment.doctorId !== doctor.id) throw new ForbiddenException('Only the consulting doctor can prescribe');
    if (row.prescription) throw new ConflictException('A prescription was already issued for this consultation');

    let created: PrescriptionRow;
    try {
      created = await this.prisma.doctorPrescription.create({
        data: {
          consultationId: id,
          doctorId: doctor.id,
          customerId: row.appointment.customerId,
          diagnosis: dto.diagnosis,
          notes: dto.notes,
          items: { create: dto.items },
        },
        include: prescriptionInclude,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('A prescription was already issued for this consultation');
      }
      throw error;
    }
    this.events.emit(Events.Notify, {
      userId: row.appointment.customerId,
      type: 'prescription.issued',
      title: 'New prescription',
      body: `Dr. ${created.doctor.user.name} issued your prescription`,
      data: { doctorPrescriptionId: created.id },
    } satisfies NotifyEvent);
    return toPrescription(created);
  }

  async myPrescriptions(customerId: string) {
    const rows = await this.prisma.doctorPrescription.findMany({
      where: { customerId },
      include: prescriptionInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPrescription);
  }

  async prescription(user: AuthUser, id: string) {
    const row = await this.prisma.doctorPrescription.findUnique({ where: { id }, include: prescriptionInclude });
    const allowed = row && (user.role === 'ADMIN' || row.customerId === user.id || row.doctorId === user.id);
    if (!row || !allowed) throw new NotFoundException('Prescription not found');
    return toPrescription(row);
  }

  /** The consultation, if `user` is its doctor or patient (or an admin); 404 otherwise. */
  async requireParticipant(user: AuthUser, id: string): Promise<ConsultationRow> {
    const row = await this.prisma.consultation.findUnique({ where: { id }, include: consultationInclude });
    const allowed =
      row &&
      (user.role === 'ADMIN' || row.appointment.customerId === user.id || row.appointment.doctorId === user.id);
    if (!row || !allowed) throw new NotFoundException('Consultation not found');
    return row;
  }

  private async toResponse(id: string): Promise<ConsultationResponseDto> {
    const c = await this.prisma.consultation.findUniqueOrThrow({ where: { id }, include: consultationInclude });
    return {
      id: c.id,
      appointmentId: c.appointmentId,
      status: c.status,
      type: c.appointment.type,
      roomId: c.roomId,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      doctor: { id: c.appointment.doctorId, name: c.appointment.doctor.user.name },
      customer: { id: c.appointment.customerId, name: c.appointment.customer.name },
      prescriptionId: c.prescription?.id ?? null,
    };
  }
}

function toPrescription(p: PrescriptionRow): DoctorPrescriptionResponseDto {
  return {
    id: p.id,
    consultationId: p.consultationId,
    diagnosis: p.diagnosis,
    notes: p.notes,
    doctor: {
      id: p.doctor.userId,
      name: p.doctor.user.name,
      specialization: p.doctor.specialization?.name ?? null,
      registrationNumber: p.doctor.registrationNumber,
    },
    patient: { id: p.customer.id, name: p.customer.name },
    items: p.items.map((i) => ({
      medicineName: i.medicineName,
      dosage: i.dosage,
      frequency: i.frequency,
      durationDays: i.durationDays,
      instructions: i.instructions,
    })),
    createdAt: p.createdAt,
  };
}
