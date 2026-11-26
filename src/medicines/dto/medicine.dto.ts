import { Transform } from 'class-transformer';
import { IsBoolean, IsString, IsUrl, IsUUID, Length } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsOptionalField } from '../../common/validation.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListMedicinesQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  search?: string;

  @IsOptionalField()
  @IsUUID()
  categoryId?: string;
}

export class CreateMedicineDto {
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  name: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 100)
  brand?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 150)
  manufacturer?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 4000)
  description?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  dosage?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 40)
  form?: string;

  @IsOptionalField()
  @IsString()
  @Length(0, 80)
  packSize?: string;

  @IsOptionalField()
  @IsUrl()
  imageUrl?: string;

  @IsBoolean()
  requiresPrescription: boolean;

  @IsUUID()
  categoryId: string;
}

export class UpdateMedicineDto extends PartialType(CreateMedicineDto, { skipNullProperties: false }) {}

export class CreateCategoryDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptionalField()
  @IsUrl()
  imageUrl?: string;
}

export class MedicineResponseDto {
  id: string;
  name: string;
  brand: string | null;
  manufacturer: string | null;
  description: string | null;
  dosage: string | null;
  form: string | null;
  packSize: string | null;
  imageUrl: string | null;
  requiresPrescription: boolean;
  categoryId: string;
  /** Lowest in-stock price across approved pharmacies, or null when unavailable. */
  minPrice: number | null;
}

export class MedicineOfferDto {
  pharmacyId: string;
  pharmacyName: string;
  price: number;
  stock: number;
}

export class MedicineDetailResponseDto extends MedicineResponseDto {
  offers: MedicineOfferDto[];
}
