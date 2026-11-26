import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { AppointmentsService } from './appointments.service.js';
import { AppointmentReasonDto, CreateAppointmentDto, ListAppointmentsQueryDto } from './dto/appointment.dto.js';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Can(RolesPolicy, 'customer')
  @Post()
  book(@CurrentUser() user: AuthUser, @Body() dto: CreateAppointmentDto) {
    return this.appointments.book(user.id, dto);
  }

  @Can(RolesPolicy, 'appointmentParticipant')
  @Get('me')
  listMine(@CurrentUser() user: AuthUser, @Query() query: ListAppointmentsQueryDto) {
    return this.appointments.listMine(user, query);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.findOne(user, id);
  }

  @Can(RolesPolicy, 'doctor')
  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.appointments.accept(user, id);
  }

  @Can(RolesPolicy, 'doctor')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppointmentReasonDto) {
    return this.appointments.reject(user, id, dto.reason);
  }

  @Can(RolesPolicy, 'appointmentParticipant')
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppointmentReasonDto) {
    return this.appointments.cancel(user, id, dto.reason);
  }
}
