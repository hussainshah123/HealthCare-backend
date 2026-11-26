import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Events, type NotifyEvent } from '../common/events.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ContactMessageResponseDto, CreateContactMessageDto } from './dto/contact.dto.js';

const TOPIC_LABEL: Record<string, string> = {
  CUSTOMER: 'Customer',
  PHARMACY: 'Pharmacy',
  DOCTOR: 'Doctor',
  RIDER: 'Rider',
  OTHER: 'General',
};

@Injectable()
export class ContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Saves a website contact message and notifies every active admin in-app. */
  async create(dto: CreateContactMessageDto): Promise<{ id: string }> {
    const row = await this.prisma.contactMessage.create({
      data: { name: dto.name, email: dto.email, phone: dto.phone ?? null, topic: dto.topic, message: dto.message },
      select: { id: true },
    });

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    for (const admin of admins) {
      this.events.emit(Events.Notify, {
        userId: admin.id,
        type: 'CONTACT_MESSAGE',
        title: `New ${TOPIC_LABEL[dto.topic] ?? 'website'} enquiry`,
        body: `${dto.name}: ${dto.message.slice(0, 120)}`,
        data: { contactMessageId: row.id },
      } satisfies NotifyEvent);
    }
    return { id: row.id };
  }

  async list(query: PaginationQueryDto & { handled?: boolean }) {
    const where = query.handled === undefined ? {} : { handled: query.handled };
    const [items, total] = await Promise.all([
      this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return paginated<ContactMessageResponseDto>(items, total, query);
  }

  async setHandled(id: string, handled: boolean): Promise<ContactMessageResponseDto> {
    const found = await this.prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundException('Message not found');
    return this.prisma.contactMessage.update({ where: { id }, data: { handled } });
  }
}
