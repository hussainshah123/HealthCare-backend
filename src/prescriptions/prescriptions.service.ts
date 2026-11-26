import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AuthUser } from '../auth/auth-user.js';
import { Events, type NotifyEvent } from '../common/events.js';
import { StorageService } from '../files/storage.service.js';
import type { Prescription } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  PrescriptionResponseDto,
  ReviewPrescriptionDto,
  UploadPrescriptionDto,
} from './dto/prescription.dto.js';

@Injectable()
export class PrescriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventEmitter2,
  ) {}

  async upload(
    customerId: string,
    file: Express.Multer.File | undefined,
    dto: UploadPrescriptionDto,
  ): Promise<PrescriptionResponseDto> {
    if (!file) throw new BadRequestException('file is required');
    const stored = await this.storage.save(`prescriptions/${customerId}`, file);
    const row = await this.prisma.prescription.create({
      data: { customerId, filePath: stored.filePath, mimeType: stored.mimeType, notes: dto.notes },
    });
    return toResponse(row);
  }

  async listMine(customerId: string) {
    const rows = await this.prisma.prescription.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toResponse);
  }

  /** Owner, the pharmacy of an order that uses it, or an admin may read the file. */
  async openFile(user: AuthUser, id: string) {
    const row = await this.prisma.prescription.findUnique({
      where: { id },
      include: { orders: { select: { pharmacyId: true } } },
    });
    const allowed =
      row &&
      (row.customerId === user.id ||
        user.role === 'ADMIN' ||
        (user.role === 'PHARMACY' && row.orders.some((o) => o.pharmacyId === user.id)));
    // Not found for everyone else, so ids of other customers' files are not confirmed.
    if (!row || !allowed) throw new NotFoundException('Prescription not found');
    return { stream: await this.storage.open(row.filePath), mimeType: row.mimeType };
  }

  /**
   * A pharmacist approves or rejects a prescription attached to one of the pharmacy's orders.
   * Approval moves those orders from PRESCRIPTION_UNDER_REVIEW to CONFIRMED; rejection cancels them.
   */
  async review(pharmacy: AuthUser, id: string, dto: ReviewPrescriptionDto) {
    if (pharmacy.status !== 'ACTIVE') {
      throw new BadRequestException('Your pharmacy must be approved before reviewing prescriptions');
    }
    const row = await this.prisma.prescription.findFirst({
      where: { id, orders: { some: { pharmacyId: pharmacy.id } } },
    });
    if (!row) throw new NotFoundException('Prescription not found');
    if (row.status !== 'PENDING') throw new ConflictException('Prescription was already reviewed');

    const status = dto.approved ? 'APPROVED' : 'REJECTED';
    const orders = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.prescription.updateMany({
        where: { id, status: 'PENDING' },
        data: { status, reviewNote: dto.note, reviewedById: pharmacy.id, reviewedAt: new Date() },
      });
      if (count === 0) throw new ConflictException('Prescription was already reviewed');

      const waiting = await tx.order.findMany({
        where: { prescriptionId: id, pharmacyId: pharmacy.id, status: 'PRESCRIPTION_UNDER_REVIEW' },
      });
      const next = dto.approved ? 'CONFIRMED' : 'CANCELLED';
      for (const order of waiting) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: next,
            cancelReason: dto.approved ? undefined : 'Prescription rejected',
            history: {
              create: {
                status: next,
                note: dto.approved ? 'Prescription approved' : `Prescription rejected${dto.note ? `: ${dto.note}` : ''}`,
                changedById: pharmacy.id,
              },
            },
          },
        });
        if (!dto.approved) await restock(tx, order.id, order.pharmacyId);
      }
      return waiting.map((o) => ({ ...o, status: next }));
    });

    for (const order of orders) {
      this.events.emit(Events.OrderStatusChanged, {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        pharmacyId: order.pharmacyId,
        status: order.status,
      });
    }
    this.events.emit(Events.Notify, {
      userId: row.customerId,
      type: 'prescription.reviewed',
      title: dto.approved ? 'Prescription approved' : 'Prescription rejected',
      body: dto.note ?? (dto.approved ? 'Your prescription was approved by the pharmacist.' : 'Your prescription could not be approved.'),
      data: { prescriptionId: id },
    } satisfies NotifyEvent);

    return toResponse({ ...row, status, reviewNote: dto.note ?? null });
  }
}

/** Puts a cancelled order's items back into the pharmacy's stock. */
export async function restock(
  tx: Pick<PrismaService, 'orderItem' | 'pharmacyInventory'>,
  orderId: string,
  pharmacyId: string,
) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const item of items) {
    await tx.pharmacyInventory.updateMany({
      where: { pharmacyId, medicineId: item.medicineId },
      data: { stock: { increment: item.quantity } },
    });
  }
}

function toResponse(row: Prescription): PrescriptionResponseDto {
  return {
    id: row.id,
    fileUrl: `/api/prescriptions/${row.id}/file`,
    mimeType: row.mimeType,
    notes: row.notes,
    status: row.status,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
  };
}
