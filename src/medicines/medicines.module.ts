import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CategoriesController, MedicinesController } from './medicines.controller.js';
import { MedicinesService } from './medicines.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController, MedicinesController],
  providers: [MedicinesService],
})
export class MedicinesModule {}
