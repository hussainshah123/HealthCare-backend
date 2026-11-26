import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Push notifications through Firebase Cloud Messaging.
 *
 * Not wired to Firebase yet: sending needs a service-account key
 * (FCM HTTP v1, or the firebase-admin SDK). Until then this logs what it
 * would send, so the rest of the system (device tokens, notification rows,
 * in-app socket events) works end to end.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async send(userId: string, title: string, body: string, data?: Record<string, unknown>) {
    const tokens = await this.prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
    if (tokens.length === 0) return;
    // TODO(FCM): send { notification: { title, body }, data } to each token; delete tokens FCM reports as unregistered.
    this.logger.debug(`push → ${userId} (${tokens.length} device(s)): ${title}`);
    void data;
  }
}
