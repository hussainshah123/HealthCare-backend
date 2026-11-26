import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { toMoney } from '../common/money.js';
import { pageArgs, paginated, type PaginationQueryDto } from '../common/pagination.js';
import type { Payment, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PaymentWebhookDto } from './dto/payment.dto.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listMine(userId: string, query: PaginationQueryDto) {
    return this.list({ userId }, query);
  }

  async list(where: Prisma.PaymentWhereInput, query: PaginationQueryDto) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { orderNumber: true } },
          user: { select: { name: true } },
        },
        ...pageArgs(query),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginated(
      rows.map((p) => ({
        ...toPayment(p),
        orderNumber: p.order?.orderNumber ?? null,
        userName: p.user.name,
      })),
      total,
      query,
    );
  }

  /**
   * Gateway callback. The body must be signed: header `x-signature` is the hex
   * HMAC-SHA256 of the raw body with PAYMENT_WEBHOOK_SECRET. Replays are harmless:
   * only PENDING payments change.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, dto: PaymentWebhookDto) {
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!secret || !rawBody || !signature || !validSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const payment = await this.prisma.payment.findUnique({ where: { id: dto.paymentId } });
    if (!payment) {
      this.logger.warn(`Webhook for unknown payment ${dto.paymentId}`);
      return { received: true };
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status: dto.status,
          gatewayRef: dto.gatewayRef,
          gatewayResponse: (dto.raw ?? {}) as Prisma.InputJsonValue,
        },
      });
      if (count === 1 && payment.orderId && dto.status === 'PAID') {
        await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'PAID' } });
      }
      if (count === 1 && payment.orderId && dto.status === 'FAILED') {
        await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'FAILED' } });
      }
    });
    return { received: true };
  }
}

function validSignature(body: Buffer, signature: string, secret: string) {
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function toPayment(p: Payment) {
  return {
    id: p.id,
    orderId: p.orderId,
    appointmentId: p.appointmentId,
    amount: toMoney(p.amount),
    currency: p.currency,
    method: p.method,
    status: p.status,
    gatewayRef: p.gatewayRef,
    createdAt: p.createdAt,
  };
}
