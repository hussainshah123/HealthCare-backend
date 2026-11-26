import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { roundMoney, toMoney } from '../common/money.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AddCartItemDto, CartResponseDto, UpdateCartItemDto } from './dto/cart.dto.js';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async get(customerId: string): Promise<CartResponseDto> {
    const rows = await this.prisma.cartItem.findMany({
      where: { customerId },
      include: {
        medicine: { select: { name: true, imageUrl: true, requiresPrescription: true } },
      },
      orderBy: { medicine: { name: 'asc' } },
    });
    const stock = await this.prisma.pharmacyInventory.findMany({
      where: {
        OR: rows.map((r) => ({ pharmacyId: r.pharmacyId, medicineId: r.medicineId })),
      },
    });
    const items = rows.map((row) => {
      const inv = stock.find(
        (s) => s.pharmacyId === row.pharmacyId && s.medicineId === row.medicineId,
      );
      return {
        id: row.id,
        medicineId: row.medicineId,
        medicineName: row.medicine.name,
        imageUrl: row.medicine.imageUrl,
        pharmacyId: row.pharmacyId,
        price: toMoney(inv?.price),
        quantity: row.quantity,
        stock: inv?.stock ?? 0,
        requiresPrescription: row.medicine.requiresPrescription,
      };
    });
    const subtotal = roundMoney(items.reduce((sum, i) => sum + i.price * i.quantity, 0));
    return { items, subtotal };
  }

  async add(customerId: string, dto: AddCartItemDto): Promise<CartResponseDto> {
    const inv = await this.prisma.pharmacyInventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId: dto.pharmacyId, medicineId: dto.medicineId } },
      include: { pharmacy: { select: { user: { select: { status: true } } } } },
    });
    if (!inv || inv.pharmacy.user.status !== 'ACTIVE') {
      throw new NotFoundException('This pharmacy does not sell this medicine');
    }

    const other = await this.prisma.cartItem.findFirst({
      where: { customerId, NOT: { pharmacyId: dto.pharmacyId } },
      select: { id: true },
    });
    if (other) {
      throw new ConflictException(
        'Your cart has items from another pharmacy. Clear the cart to order from this one.',
      );
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        customerId_medicineId_pharmacyId: {
          customerId,
          medicineId: dto.medicineId,
          pharmacyId: dto.pharmacyId,
        },
      },
    });
    const quantity = (existing?.quantity ?? 0) + dto.quantity;
    if (quantity > inv.stock) throw new BadRequestException(`Only ${inv.stock} in stock`);

    await this.prisma.cartItem.upsert({
      where: {
        customerId_medicineId_pharmacyId: {
          customerId,
          medicineId: dto.medicineId,
          pharmacyId: dto.pharmacyId,
        },
      },
      create: { customerId, medicineId: dto.medicineId, pharmacyId: dto.pharmacyId, quantity },
      update: { quantity },
    });
    return this.get(customerId);
  }

  async update(customerId: string, id: string, dto: UpdateCartItemDto): Promise<CartResponseDto> {
    const item = await this.prisma.cartItem.findFirst({ where: { id, customerId } });
    if (!item) throw new NotFoundException('Cart item not found');
    const inv = await this.prisma.pharmacyInventory.findUnique({
      where: { pharmacyId_medicineId: { pharmacyId: item.pharmacyId, medicineId: item.medicineId } },
    });
    if (!inv || dto.quantity > inv.stock) {
      throw new BadRequestException(`Only ${inv?.stock ?? 0} in stock`);
    }
    await this.prisma.cartItem.update({ where: { id }, data: { quantity: dto.quantity } });
    return this.get(customerId);
  }

  async remove(customerId: string, id: string): Promise<CartResponseDto> {
    const { count } = await this.prisma.cartItem.deleteMany({ where: { id, customerId } });
    if (count === 0) throw new NotFoundException('Cart item not found');
    return this.get(customerId);
  }

  async clear(customerId: string): Promise<void> {
    await this.prisma.cartItem.deleteMany({ where: { customerId } });
  }
}
