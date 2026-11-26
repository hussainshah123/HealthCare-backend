import { IsDateString, IsIn, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsOptionalField } from '../../common/validation.js';
import { AppointmentStatus } from '../../generated/prisma/enums.js';

export class CreateAppointmentDto {
  @IsUUID()
  doctorId: string;

  /** Must be the exact start of one of the doctor's slots (from GET /doctors/:id/slots). */
  @IsDateString({ strict: true })
  startsAt: string;

  @IsIn(['AUDIO', 'VIDEO', 'CHAT'])
  type: 'AUDIO' | 'VIDEO' | 'CHAT';

  @IsOptionalField()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}

export class AppointmentReasonDto {
  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class ListAppointmentsQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @IsIn(Object.values(AppointmentStatus))
  status?: AppointmentStatus;
}

export class AppointmentResponseDto {
  id: string;
  status: string;
  type: string;
  startsAt: Date;
  endsAt: Date;
  fee: number;
  reason: string | null;
  cancelReason: string | null;
  doctor: { id: string; name: string; specialization: string | null; avatarUrl: string | null };
  customer: { id: string; name: string };
  consultationId: string | null;
  createdAt: Date;
}
