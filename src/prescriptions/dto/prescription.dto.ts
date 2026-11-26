import { IsBoolean, IsString, Length } from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export class UploadPrescriptionDto {
  @IsOptionalField()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

export class ReviewPrescriptionDto {
  @IsBoolean()
  approved: boolean;

  @IsOptionalField()
  @IsString()
  @Length(0, 1000)
  note?: string;
}

export class PrescriptionResponseDto {
  id: string;
  /** API path that streams the file to authorized users. */
  fileUrl: string;
  mimeType: string;
  notes: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: Date;
}
