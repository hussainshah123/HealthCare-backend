import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsOptionalField } from '../../common/validation.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListDoctorsQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  search?: string;

  @IsOptionalField()
  @IsUUID()
  specializationId?: string;

  @IsOptionalField()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxFee?: number;
}

export class SlotsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date: string;
}

export class UpdateDoctorDto {
  @IsOptionalField()
  @IsUUID()
  specializationId?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 500)
  qualifications?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 60)
  registrationNumber?: string;

  @IsOptionalField()
  @IsInt()
  @Min(0)
  @Max(70)
  experienceYears?: number;

  @IsOptionalField()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  fee?: number;

  @IsOptionalField()
  @IsString()
  @Length(0, 2000)
  bio?: string;

  @IsOptionalField()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  languages?: string[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilitySlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Matches(TIME, { message: 'startTime must be HH:mm' })
  startTime: string;

  @Matches(TIME, { message: 'endTime must be HH:mm' })
  endTime: string;

  @IsIn([15, 20, 30, 60])
  slotMinutes: number;
}

export class SetAvailabilityDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots: AvailabilitySlotDto[];
}

export class CreateSpecializationDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;
}

export class DoctorCardDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  /** Specialization name */
  specialization: string | null;
  specializationId: string | null;
  experienceYears: number;
  fee: number;
  rating: number;
  ratingCount: number;
  languages: string[];
}

export class DoctorDetailDto extends DoctorCardDto {
  qualifications: string | null;
  registrationNumber: string | null;
  bio: string | null;
  reviews: { rating: number; comment: string | null; customerName: string; createdAt: Date }[];
}

export class DoctorMeDto extends DoctorDetailDto {
  email: string;
  phone: string;
  status: string;
}

export class SlotDto {
  startsAt: Date;
  endsAt: Date;
  available: boolean;
}
