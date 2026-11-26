import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdatePharmacyDto {
  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptionalField()
  @IsString()
  @Length(3, 300)
  address?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 80)
  city?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 80)
  licenseNumber?: string;

  @IsOptionalField()
  @IsLatitude()
  lat?: number;

  @IsOptionalField()
  @IsLongitude()
  lng?: number;
}

export class CreateInventoryDto {
  @IsUUID()
  medicineId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;

  @IsOptionalField()
  @IsString()
  @Length(1, 60)
  batchNumber?: string;

  @IsOptionalField()
  @IsDateString({ strict: true })
  expiryDate?: string;
}

export class UpdateInventoryDto {
  @IsOptionalField()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  price?: number;

  @IsOptionalField()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptionalField()
  @IsString()
  @Length(1, 60)
  batchNumber?: string;

  @IsOptionalField()
  @IsDateString({ strict: true })
  expiryDate?: string;
}

export class PharmacyResponseDto {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  licenseNumber: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
}

export class InventoryResponseDto {
  id: string;
  medicineId: string;
  medicineName: string;
  requiresPrescription: boolean;
  price: number;
  stock: number;
  batchNumber: string | null;
  expiryDate: string | null;
  updatedAt: Date;
}
