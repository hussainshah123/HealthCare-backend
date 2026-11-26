import { ArrayMaxSize, IsArray, IsNumber, IsString, Max, Min } from 'class-validator';

export class PlatformSettingsDto {
  /** Flat delivery fee charged to the customer. */
  @IsNumber()
  @Min(0)
  deliveryFee: number;

  /** Platform's cut of each medicine order subtotal (pharmacy payable = subtotal − commission). */
  @IsNumber()
  @Min(0)
  @Max(100)
  platformCommissionPercent: number;

  /** Platform's cut of each consultation fee. */
  @IsNumber()
  @Min(0)
  @Max(100)
  doctorCommissionPercent: number;

  /** Share of the delivery fee paid to the rider. */
  @IsNumber()
  @Min(0)
  @Max(100)
  riderFeePercent: number;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  serviceCities: string[];
}
