import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsOptionalField } from '../../common/validation.js';
import { OrderStatus } from '../../generated/prisma/enums.js';

export class CreateOrderDto {
  @IsUUID()
  addressId: string;

  @IsIn(['COD', 'ONLINE'])
  paymentMethod: 'COD' | 'ONLINE';

  @IsOptionalField()
  @IsUUID()
  prescriptionId?: string;

  @IsOptionalField()
  @IsString()
  @Length(2, 40)
  couponCode?: string;
}

export class CancelOrderDto {
  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

/** Statuses a pharmacy may set through PATCH /orders/:id/status. */
export const PHARMACY_SETTABLE = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'] as const;

export class UpdateOrderStatusDto {
  @IsIn(PHARMACY_SETTABLE)
  status: (typeof PHARMACY_SETTABLE)[number];

  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;
}

export class OrderItemResponseDto {
  medicineId: string;
  name: string;
  price: number;
  quantity: number;
}

export class OrderHistoryResponseDto {
  status: string;
  note: string | null;
  createdAt: Date;
}

export class OrderDeliveryResponseDto {
  id: string;
  status: string;
  riderId: string;
  riderName: string;
  riderPhone: string;
  assignedAt: Date;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
}

export class OrderResponseDto {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  items: OrderItemResponseDto[];
  address: unknown;
  pharmacy: { id: string; name: string };
  customer: { id: string; name: string; phone: string };
  prescriptionId: string | null;
  cancelReason: string | null;
  history: OrderHistoryResponseDto[];
  delivery: OrderDeliveryResponseDto | null;
  /** Only for the customer, while the order is out for delivery. */
  deliveryOtp?: string;
  createdAt: Date;
}
