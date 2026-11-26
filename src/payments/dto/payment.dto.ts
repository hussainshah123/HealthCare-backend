import { IsIn, IsObject, IsString, IsUUID, Length } from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export class PaymentWebhookDto {
  @IsUUID()
  paymentId: string;

  @IsIn(['PAID', 'FAILED'])
  status: 'PAID' | 'FAILED';

  @IsString()
  @Length(1, 200)
  gatewayRef: string;

  /** The gateway's full event, kept for reconciliation. */
  @IsOptionalField()
  @IsObject()
  raw?: Record<string, unknown>;
}
