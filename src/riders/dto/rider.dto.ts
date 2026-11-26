import { IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export class UpdateRiderDto {
  @IsOptionalField()
  @IsIn(['MOTORCYCLE', 'BICYCLE', 'CAR'])
  vehicleType?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 20)
  vehicleNumber?: string;

  @IsOptionalField()
  @IsString()
  @Length(3, 40)
  licenseNumber?: string;

  /** Pakistani CNIC: 13 digits, dashes optional (12345-1234567-1). */
  @IsOptionalField()
  @Matches(/^\d{5}-?\d{7}-?\d$/, { message: 'cnic must be 13 digits (12345-1234567-1)' })
  cnic?: string;
}

export class RiderAvailabilityDto {
  @IsBoolean()
  online: boolean;
}

export class RiderProfileResponseDto {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  avatarUrl: string | null;
  vehicleType: string | null;
  vehicleNumber: string | null;
  licenseNumber: string | null;
  cnic: string | null;
  online: boolean;
}

export class RiderEarningsResponseDto {
  total: number;
  deliveries: number;
  items: { deliveryId: string; orderNumber: string; fee: number; deliveredAt: Date | null }[];
}
