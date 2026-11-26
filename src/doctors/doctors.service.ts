import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { roundMoney, toMoney } from '../common/money.js';
import { pageArgs, paginated } from '../common/pagination.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type {
  AvailabilitySlotDto,
  CreateSpecializationDto,
  DoctorCardDto,
  DoctorDetailDto,
  DoctorMeDto,
  ListDoctorsQueryDto,
  SlotDto,
  UpdateDoctorDto,
} from './dto/doctor.dto.js';
import { hasOverlap, platformOffsetMinutes, slotsForDate, toMinutes } from './slots.js';

const cardInclude = {
  user: { select: { name: true, avatarUrl: true, email: true, phone: true, status: true } },
  specialization: true,
} satisfies Prisma.DoctorProfileInclude;

type DoctorRow = Prisma.DoctorProfileGetPayload<{ include: typeof cardInclude }>;

@Injectable()
export class DoctorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  listSpecializations() {
    return this.prisma.specialization.findMany({ orderBy: { name: 'asc' } });
  }

  async createSpecialization(dto: CreateSpecializationDto) {
    try {
      return await this.prisma.specialization.create({ data: dto });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Specialization already exists');
      throw error;
    }
  }

  /** Only approved doctors are listed and bookable. */
  async list(query: ListDoctorsQueryDto) {
    const where: Prisma.DoctorProfileWhereInput = {
      user: {
        status: 'ACTIVE',
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
      },
      specializationId: query.specializationId,
      ...(query.maxFee !== undefined ? { fee: { lte: query.maxFee } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findMany({
        where,
        include: cardInclude,
        orderBy: [{ rating: 'desc' }, { experienceYears: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.doctorProfile.count({ where }),
    ]);
    return paginated(rows.map(toCard), total, query);
  }

  async findOne(id: string): Promise<DoctorDetailDto> {
    const row = await this.prisma.doctorProfile.findFirst({
      where: { userId: id, user: { status: 'ACTIVE' } },
      include: cardInclude,
    });
    if (!row) throw new NotFoundException('Doctor not found');
    return this.toDetail(row);
  }

  async getMine(userId: string): Promise<DoctorMeDto> {
    const row = await this.prisma.doctorProfile.findUniqueOrThrow({ where: { userId }, include: cardInclude });
    return {
      ...(await this.toDetail(row)),
      email: row.user.email,
      phone: row.user.phone,
      status: row.user.status,
    };
  }

  async updateMine(userId: string, dto: UpdateDoctorDto) {
    if (dto.specializationId) {
      const exists = await this.prisma.specialization.count({ where: { id: dto.specializationId } });
      if (!exists) throw new NotFoundException('Specialization not found');
    }
    await this.prisma.doctorProfile.update({ where: { userId }, data: dto });
    return this.getMine(userId);
  }

  async getAvailability(doctorId: string) {
    const rows = await this.prisma.doctorAvailability.findMany({
      where: { doctorId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(({ dayOfWeek, startTime, endTime, slotMinutes }) => ({ dayOfWeek, startTime, endTime, slotMinutes }));
  }

  /** Replaces the doctor's weekly schedule. Existing bookings are kept. */
  async setAvailability(doctorId: string, slots: AvailabilitySlotDto[]) {
    for (const s of slots) {
      if (toMinutes(s.endTime) - toMinutes(s.startTime) < s.slotMinutes) {
        throw new BadRequestException(`Window ${s.startTime}–${s.endTime} is shorter than one ${s.slotMinutes}-minute slot`);
      }
    }
    if (hasOverlap(slots)) throw new BadRequestException('Availability windows on the same day overlap');
    await this.prisma.$transaction([
      this.prisma.doctorAvailability.deleteMany({ where: { doctorId } }),
      this.prisma.doctorAvailability.createMany({ data: slots.map((s) => ({ ...s, doctorId })) }),
    ]);
    return this.getAvailability(doctorId);
  }

  async slots(doctorId: string, date: string): Promise<SlotDto[]> {
    const doctor = await this.prisma.doctorProfile.findFirst({
      where: { userId: doctorId, user: { status: 'ACTIVE' } },
      include: { availability: true },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    const all = slotsForDate(date, doctor.availability, platformOffsetMinutes());
    if (all.length === 0) return [];

    const booked = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        slotKey: { not: null },
        startsAt: { gte: all[0].startsAt, lte: all[all.length - 1].startsAt },
      },
      select: { startsAt: true },
    });
    const taken = new Set(booked.map((b) => b.startsAt.getTime()));
    const now = Date.now();
    return all.map((s) => ({
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      available: s.startsAt.getTime() > now && !taken.has(s.startsAt.getTime()),
    }));
  }

  async earnings(doctorId: string) {
    const settings = await this.settings.get();
    const rows = await this.prisma.appointment.findMany({
      where: { doctorId, status: 'COMPLETED' },
      orderBy: { startsAt: 'desc' },
      include: { customer: { select: { name: true } } },
    });
    const items = rows.map((a) => {
      const gross = toMoney(a.fee);
      const commission = roundMoney((gross * settings.doctorCommissionPercent) / 100);
      return {
        appointmentId: a.id,
        patientName: a.customer.name,
        startsAt: a.startsAt,
        gross,
        commission,
        net: roundMoney(gross - commission),
      };
    });
    const sum = (key: 'gross' | 'commission' | 'net') => roundMoney(items.reduce((t, i) => t + i[key], 0));
    const payouts = await this.prisma.payout.findMany({ where: { userId: doctorId }, orderBy: { createdAt: 'desc' } });
    return {
      gross: sum('gross'),
      commission: sum('commission'),
      net: sum('net'),
      consultations: items.length,
      items,
      payouts: payouts.map((p) => ({ id: p.id, amount: toMoney(p.amount), status: p.status, periodStart: p.periodStart, periodEnd: p.periodEnd })),
    };
  }

  private async toDetail(row: DoctorRow): Promise<DoctorDetailDto> {
    const reviews = await this.prisma.doctorReview.findMany({
      where: { doctorId: row.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { customer: { select: { name: true } } },
    });
    return {
      ...toCard(row),
      qualifications: row.qualifications,
      registrationNumber: row.registrationNumber,
      bio: row.bio,
      reviews: reviews.map((r) => ({ rating: r.rating, comment: r.comment, customerName: r.customer.name, createdAt: r.createdAt })),
    };
  }
}

function toCard(row: DoctorRow): DoctorCardDto {
  return {
    id: row.userId,
    name: row.user.name,
    avatarUrl: row.user.avatarUrl,
    specialization: row.specialization?.name ?? null,
    specializationId: row.specializationId,
    experienceYears: row.experienceYears,
    fee: toMoney(row.fee),
    rating: row.rating,
    ratingCount: row.ratingCount,
    languages: row.languages,
  };
}
