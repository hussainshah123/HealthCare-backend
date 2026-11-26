import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { RolesPolicy } from '../auth/roles.policy.js';
import {
  CreateCategoryDto,
  CreateMedicineDto,
  ListMedicinesQueryDto,
  UpdateMedicineDto,
} from './dto/medicine.dto.js';
import { MedicinesService } from './medicines.service.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Can.Anyone()
  @Get()
  list() {
    return this.medicines.listCategories();
  }

  @Can(RolesPolicy, 'admin')
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.medicines.createCategory(dto);
  }
}

@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Can.Anyone()
  @Get()
  list(@Query() query: ListMedicinesQueryDto) {
    return this.medicines.list(query);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.medicines.findOne(id);
  }

  @Can(RolesPolicy, 'admin')
  @Post()
  create(@Body() dto: CreateMedicineDto) {
    return this.medicines.create(dto);
  }

  @Can(RolesPolicy, 'admin')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMedicineDto) {
    return this.medicines.update(id, dto);
  }
}
