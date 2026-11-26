import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { CancelOrderDto, CreateOrderDto, ListOrdersQueryDto, UpdateOrderStatusDto } from './dto/order.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Can(RolesPolicy, 'customer')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
  }

  // Static paths before ':id' (Express matches in declaration order).
  @Can(RolesPolicy, 'customer')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.orders.listMine(user.id, query);
  }

  @Can(RolesPolicy, 'pharmacy')
  @Get('pharmacy')
  listForPharmacy(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto) {
    return this.orders.listForPharmacy(user.id, query);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.findOne(user, id);
  }

  @Can(RolesPolicy, 'customer')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancelByCustomer(user.id, id, dto);
  }

  @Can(RolesPolicy, 'customer')
  @Post(':id/reorder')
  @HttpCode(200)
  reorder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.reorder(user.id, id);
  }

  @Can(RolesPolicy, 'pharmacy')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatusByPharmacy(user, id, dto);
  }
}
