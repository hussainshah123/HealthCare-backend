import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ConsultationsController, DoctorPrescriptionsController } from './consultations.controller.js';
import { ConsultationsGateway } from './consultations.gateway.js';
import { ConsultationsService } from './consultations.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ConsultationsController, DoctorPrescriptionsController],
  providers: [ConsultationsService, ConsultationsGateway],
})
export class ConsultationsModule {}
