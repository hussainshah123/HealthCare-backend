import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
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

/**
 * One CSV row as the pharmacy typed it. Fields stay loose (strings) so a bad
 * row is reported back with its row number instead of failing the whole file.
 */
export class BulkInventoryRowDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  row: number;

  @IsOptionalField()
  @IsString()
  @Length(0, 200)
  medicine?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 40)
  price?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 40)
  stock?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 60)
  batchNumber?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 40)
  expiryDate?: string;
}

export class BulkInventoryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BulkInventoryRowDto)
  rows: BulkInventoryRowDto[];

  /** Check every row and report what would happen, without saving anything. */
  @IsOptionalField()
  @IsBoolean()
  dryRun?: boolean;
}

export interface BulkInventoryRowResult {
  row: number;
  medicine: string;
  status: 'create' | 'update' | 'error';
  reason?: string;
}

export interface BulkInventoryResultDto {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: BulkInventoryRowResult[];
}
