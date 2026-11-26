import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DoctorsController, SpecializationsController } from './doctors.controller.js';
import { DoctorsService } from './doctors.service.js';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [SpecializationsController, DoctorsController],
  providers: [DoctorsService],
})
export class DoctorsModule {}
