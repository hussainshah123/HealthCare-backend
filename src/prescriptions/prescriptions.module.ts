import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrescriptionsController } from './prescriptions.controller.js';
import { PrescriptionsService } from './prescriptions.service.js';

@Module({
  imports: [PrismaModule, FilesModule],
  controllers: [PrescriptionsController],
  providers: [PrescriptionsService],
})
export class PrescriptionsModule {}
