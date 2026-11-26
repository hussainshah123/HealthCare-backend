import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { PaginationQueryDto } from '../common/pagination.js';
import { DeliveriesService } from './deliveries.service.js';
import { CompleteDeliveryDto, LocationUpdateDto } from './dto/delivery.dto.js';

@Controller('deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Can(RolesPolicy, 'rider')
  @Get('available')
  available(@CurrentUser() user: AuthUser) {
    return this.deliveries.available(user);
  }

  @Can(RolesPolicy, 'rider')
  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.deliveries.active(user.id);
  }

  @Can(RolesPolicy, 'rider')
  @Get('history')
  history(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.deliveries.history(user.id, query);
  }

  @Can.Anyone()
  @Get('order/:orderId/tracking')
  tracking(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.deliveries.tracking(user, orderId);
  }

  @Can(RolesPolicy, 'rider')
  @Post(':orderId/accept')
  accept(@CurrentUser() user: AuthUser, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.deliveries.accept(user, orderId);
  }

  @Can(RolesPolicy, 'rider')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.reject(user, id);
  }

  @Can(RolesPolicy, 'rider')
  @Post(':id/pickup')
  @HttpCode(200)
  pickup(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.pickup(user, id);
  }

  @Can(RolesPolicy, 'rider')
  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.deliveries.start(user, id);
  }

  /** Few attempts per minute, so the 4-digit code can't be brute-forced. */
  @Can(RolesPolicy, 'rider')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteDeliveryDto,
  ) {
    return this.deliveries.complete(user, id, dto.otp);
  }

  /** HTTP fallback for location updates when the socket is down. */
  @Can(RolesPolicy, 'rider')
  @Post(':id/location')
  @HttpCode(200)
  location(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LocationUpdateDto,
  ) {
    return this.deliveries.recordLocation(user, id, dto);
  }
}
