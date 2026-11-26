import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { DeliveriesService } from '../deliveries/deliveries.service.js';
import { AssignRiderDto } from '../deliveries/dto/delivery.dto.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PlatformSettingsDto } from '../settings/dto/settings.dto.js';
import { SettingsService } from '../settings/settings.service.js';
import { AdminService } from './admin.service.js';
import {
  AdminAppointmentsQueryDto,
  AdminOrdersQueryDto,
  ListUsersQueryDto,
  UpdateUserStatusDto,
} from './dto/admin.dto.js';

@Can(RolesPolicy, 'admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly deliveries: DeliveriesService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.admin.updateUserStatus(user, id, dto);
  }

  @Get('orders')
  listOrders(@Query() query: AdminOrdersQueryDto) {
    return this.admin.listOrders(query);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getOrder(id);
  }

  @Post('deliveries/assign')
  assign(@CurrentUser() user: AuthUser, @Body() dto: AssignRiderDto) {
    return this.deliveries.assignByAdmin(user, dto.orderId, dto.riderId);
  }

  @Get('deliveries/active')
  activeDeliveries() {
    return this.deliveries.listActive();
  }

  @Get('riders/online')
  onlineRiders() {
    return this.admin.onlineRiders();
  }

  @Get('appointments')
  appointments(@Query() query: AdminAppointmentsQueryDto) {
    return this.admin.listAppointments(query);
  }

  @Get('payments')
  listPayments(@Query() query: PaginationQueryDto) {
    return this.payments.list({}, query);
  }

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Put('settings')
  updateSettings(@Body() dto: PlatformSettingsDto) {
    return this.settings.update(dto);
  }
}
