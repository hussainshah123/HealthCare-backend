import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import type { AuthUser } from '../auth/auth-user.js';
import { RolesPolicy } from '../auth/roles.policy.js';
import { ConsultationsService } from './consultations.service.js';
import { CreateDoctorPrescriptionDto, SendMessageDto } from './dto/consultation.dto.js';

@Controller('consultations')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Can(RolesPolicy, 'doctor')
  @Post(':appointmentId/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('appointmentId', ParseUUIDPipe) appointmentId: string) {
    return this.consultations.start(user, appointmentId);
  }

  @Can.Anyone()
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.get(user, id);
  }

  @Can(RolesPolicy, 'doctor')
  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.end(user, id);
  }

  @Can(RolesPolicy, 'appointmentParticipant')
  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.messages(user, id);
  }

  @Can(RolesPolicy, 'appointmentParticipant')
  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.consultations.sendMessage(user, id, dto.body);
  }

  @Can(RolesPolicy, 'doctor')
  @Post(':id/prescription')
  prescribe(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDoctorPrescriptionDto,
  ) {
    return this.consultations.prescribe(user, id, dto);
  }
}

@Controller('doctor-prescriptions')
export class DoctorPrescriptionsController {
  constructor(private readonly consultations: ConsultationsService) {}

  @Can(RolesPolicy, 'customer')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.consultations.myPrescriptions(user.id);
  }

  @Can.Anyone()
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consultations.prescription(user, id);
  }
}
