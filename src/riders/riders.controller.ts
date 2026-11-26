import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { RiderAvailabilityDto, UpdateRiderDto } from './dto/rider.dto.js';
import { RidersService } from './riders.service.js';

@Can(RolesPolicy, 'rider')
@Controller('riders/me')
export class RidersController {
  constructor(private readonly riders: RidersService) {}

  @Get()
  getMine(@CurrentUser() user: AuthUser) {
    return this.riders.getMine(user.id);
  }

  @Patch()
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateRiderDto) {
    return this.riders.updateMine(user.id, dto);
  }

  @Patch('availability')
  setAvailability(@CurrentUser() user: AuthUser, @Body() dto: RiderAvailabilityDto) {
    return this.riders.setAvailability(user, dto);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.riders.earnings(user.id);
  }
}
