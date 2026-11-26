import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InventoryController, PharmaciesController } from './pharmacies.controller.js';
import { PharmaciesService } from './pharmacies.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PharmaciesController, InventoryController],
  providers: [PharmaciesService],
})
export class PharmaciesModule {}
