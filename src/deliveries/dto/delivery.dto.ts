import { IsLatitude, IsLongitude, IsNumber, IsUUID, Matches, Max, Min } from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export class CompleteDeliveryDto {
  @Matches(/^\d{4}$/, { message: 'otp must be the 4-digit code from the customer' })
  otp: string;
}

export class LocationUpdateDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;

  @IsOptionalField()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  /** metres per second */
  @IsOptionalField()
  @IsNumber()
  @Min(0)
  @Max(100)
  speed?: number;
}

/** Socket payload for `rider:location`. */
export class SocketLocationDto extends LocationUpdateDto {
  @IsUUID()
  deliveryId: string;
}

export class JoinDeliveryDto {
  @IsUUID()
  orderId: string;
}

export class AssignRiderDto {
  @IsUUID()
  orderId: string;

  @IsUUID()
  riderId: string;
}

export class DeliveryResponseDto {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  fee: number;
  pharmacy: { name: string; address: string | null; lat: number | null; lng: number | null };
  dropoff: { line1: string; city: string; lat: number | null; lng: number | null };
  customerName: string;
  customerPhone: string;
  assignedAt: Date;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
}

export class AvailableDeliveryDto {
  orderId: string;
  orderNumber: string;
  fee: number;
  pharmacy: { name: string; address: string | null; lat: number | null; lng: number | null };
  /** Area only until the rider accepts. */
  dropoff: { city: string; lat: number | null; lng: number | null };
  readyAt: Date;
}

export class LocationPointDto {
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  recordedAt: Date;
}

export class TrackingResponseDto {
  delivery: DeliveryResponseDto;
  rider: { name: string; phone: string; avatarUrl: string | null; vehicleNumber: string | null };
  lastLocation: LocationPointDto | null;
  destination: { lat: number | null; lng: number | null; line1: string };
  pharmacy: { lat: number | null; lng: number | null; name: string };
}
