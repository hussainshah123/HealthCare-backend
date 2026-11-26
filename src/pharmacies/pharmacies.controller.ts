import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { CreateInventoryDto, UpdateInventoryDto, UpdatePharmacyDto } from './dto/pharmacy.dto.js';
import { PharmaciesService } from './pharmacies.service.js';

@Controller('pharmacies')
export class PharmaciesController {
  constructor(private readonly pharmacies: PharmaciesService) {}

  @Can.Anyone()
  @Get()
  list() {
    return this.pharmacies.listApproved();
  }

  @Can(RolesPolicy, 'pharmacy')
  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.pharmacies.getMine(user.id);
  }

  @Can(RolesPolicy, 'pharmacy')
  @Patch('me')
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdatePharmacyDto) {
    return this.pharmacies.updateMine(user.id, dto);
  }
}

@Can(RolesPolicy, 'pharmacy')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly pharmacies: PharmaciesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.pharmacies.listInventory(user.id, query);
  }

  @Post()
  add(@CurrentUser() user: AuthUser, @Body() dto: CreateInventoryDto) {
    return this.pharmacies.addInventory(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryDto,
  ) {
    return this.pharmacies.updateInventory(user.id, id, dto);
  }
}
