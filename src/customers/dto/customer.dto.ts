import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateCustomerDto {
  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptionalField()
  @Transform(trim)
  @Matches(/^\+?[0-9]{10,15}$/)
  phone?: string;

  @IsOptionalField()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptionalField()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
}

export class CreateAddressDto {
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  label: string;

  @Transform(trim)
  @IsString()
  @Length(3, 200)
  line1: string;

  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(0, 200)
  line2?: string;

  @Transform(trim)
  @IsString()
  @Length(2, 80)
  city: string;

  @IsOptionalField()
  @IsLatitude()
  lat?: number;

  @IsOptionalField()
  @IsLongitude()
  lng?: number;

  @IsOptionalField()
  @IsBoolean()
  isDefault?: boolean;
}

export class AddressResponseDto {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

export class CustomerProfileResponseDto {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  gender: string | null;
}
