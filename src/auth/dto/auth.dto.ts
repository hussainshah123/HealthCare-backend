import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import type { Role } from '../../generated/prisma/enums.js';
import { IsOptionalField } from '../../common/validation.js';
import { UserResponseDto } from '../auth-user.js';

/** Roles a person can sign up for. Admins are created by seed/other admins only. */
export const SELF_SERVICE_ROLES = ['CUSTOMER', 'DOCTOR', 'RIDER', 'PHARMACY'] as const;

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be 10–15 digits, optionally starting with +' })
  phone: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @IsIn(SELF_SERVICE_ROLES)
  role: Exclude<Role, 'ADMIN'>;

  /**
   * Optional GPS position from the phone at sign-up (sent only when the person
   * allows location access). Customers also get it as their default address.
   */
  @IsOptionalField()
  @IsLatitude()
  lat?: number;

  @IsOptionalField()
  @IsLongitude()
  lng?: number;
}

export class LoginDto {
  @Transform(lowerTrim)
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserResponseDto;
}
