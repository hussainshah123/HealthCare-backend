import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class AddCartItemDto {
  @IsUUID()
  medicineId: string;

  @IsUUID()
  pharmacyId: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;
}

export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;
}

export class CartItemResponseDto {
  id: string;
  medicineId: string;
  medicineName: string;
  imageUrl: string | null;
  pharmacyId: string;
  price: number;
  quantity: number;
  stock: number;
  requiresPrescription: boolean;
}

export class CartResponseDto {
  items: CartItemResponseDto[];
  subtotal: number;
}
