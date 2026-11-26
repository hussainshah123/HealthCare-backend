import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { DoctorsService } from './doctors.service.js';
import {
  CreateSpecializationDto,
  ListDoctorsQueryDto,
  SetAvailabilityDto,
  SlotsQueryDto,
  UpdateDoctorDto,
} from './dto/doctor.dto.js';

@Controller('specializations')
export class SpecializationsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Can.Anyone()
  @Get()
  list() {
    return this.doctors.listSpecializations();
  }

  @Can(RolesPolicy, 'admin')
  @Post()
  create(@Body() dto: CreateSpecializationDto) {
    return this.doctors.createSpecialization(dto);
  }
}

@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Can.Anyone()
  @Get()
  list(@Query() query: ListDoctorsQueryDto) {
    return this.doctors.list(query);
  }

  // `me` routes come before `:id` (Express matches in declaration order).
  @Can(RolesPolicy, 'doctor')
  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.doctors.getMine(user.id);
  }

  @Can(RolesPolicy, 'doctor')
  @Patch('me')
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateDoctorDto) {
    return this.doctors.updateMine(user.id, dto);
  }

  @Can(RolesPolicy, 'doctor')
  @Get('me/availability')
  getAvailability(@CurrentUser() user: AuthUser) {
    return this.doctors.getAvailability(user.id);
  }

  @Can(RolesPolicy, 'doctor')
  @Put('me/availability')
  setAvailability(@CurrentUser() user: AuthUser, @Body() dto: SetAvailabilityDto) {
    return this.doctors.setAvailability(user.id, dto.slots);
  }

  @Can(RolesPolicy, 'doctor')
  @Get('me/earnings')
  earnings(@CurrentUser() user: AuthUser) {
    return this.doctors.earnings(user.id);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.doctors.findOne(id);
  }

  @Can.Anyone()
  @Get(':id/slots')
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() query: SlotsQueryDto) {
    return this.doctors.slots(id, query.date);
  }
}
