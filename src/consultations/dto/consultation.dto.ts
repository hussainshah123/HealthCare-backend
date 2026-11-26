import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export class SendMessageDto {
  @IsString()
  @Length(1, 4000)
  body: string;
}

export class PrescriptionItemDto {
  @IsString()
  @Length(1, 150)
  medicineName: string;

  @IsString()
  @Length(1, 100)
  dosage: string;

  @IsString()
  @Length(1, 100)
  frequency: string;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays: number;

  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  instructions?: string;
}

export class CreateDoctorPrescriptionDto {
  @IsString()
  @Length(2, 1000)
  diagnosis: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items: PrescriptionItemDto[];
}

// ── socket payloads ──

export class JoinConsultationDto {
  @IsUUID()
  consultationId: string;
}

export class SocketMessageDto extends JoinConsultationDto {
  @IsString()
  @Length(1, 4000)
  body: string;
}

export class SignalDto extends JoinConsultationDto {
  @IsDefined()
  @IsObject()
  data: Record<string, unknown>;
}


// ── responses ──

export class ConsultationResponseDto {
  id: string;
  appointmentId: string;
  status: string;
  type: string;
  roomId: string;
  startedAt: Date | null;
  endedAt: Date | null;
  doctor: { id: string; name: string };
  customer: { id: string; name: string };
  prescriptionId: string | null;
}

export class MessageResponseDto {
  id: string;
  senderId: string;
  body: string;
  createdAt: Date;
}

export class DoctorPrescriptionResponseDto {
  id: string;
  consultationId: string;
  diagnosis: string;
  notes: string | null;
  doctor: { id: string; name: string; specialization: string | null; registrationNumber: string | null };
  patient: { id: string; name: string };
  items: { medicineName: string; dosage: string; frequency: string; durationDays: number; instructions: string | null }[];
  createdAt: Date;
}
