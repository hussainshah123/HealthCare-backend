import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RidersController } from './riders.controller.js';
import { RidersService } from './riders.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [RidersController],
  providers: [RidersService],
})
export class RidersModule {}
