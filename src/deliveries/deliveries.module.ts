import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DeliveriesController } from './deliveries.controller.js';
import { DeliveriesService } from './deliveries.service.js';
import { TrackingGateway } from './tracking.gateway.js';

@Module({
  imports: [PrismaModule, SettingsModule, AuthModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, TrackingGateway],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
