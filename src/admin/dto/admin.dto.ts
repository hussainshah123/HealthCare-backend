import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsOptionalField } from '../../common/validation.js';
import { AccountStatus, AppointmentStatus, OrderStatus, Role } from '../../generated/prisma/enums.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @IsIn(Object.values(Role))
  role?: Role;

  @IsOptionalField()
  @IsIn(Object.values(AccountStatus))
  status?: AccountStatus;

  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  search?: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'REJECTED', 'SUSPENDED'])
  status: 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

  @IsOptionalField()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class AdminOrdersQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @IsIn(Object.values(OrderStatus))
  status?: OrderStatus;

  /** Order number or customer name/phone. */
  @IsOptionalField()
  @Transform(trim)
  @IsString()
  @Length(0, 100)
  search?: string;
}

export class AdminAppointmentsQueryDto extends PaginationQueryDto {
  @IsOptionalField()
  @IsIn(Object.values(AppointmentStatus))
  status?: AppointmentStatus;
}

export class AdminStatsDto {
  customers: number;
  doctors: number;
  riders: number;
  pharmacies: number;
  orders: number;
  activeDeliveries: number;
  consultations: number;
  revenue: number;
  pendingApprovals: number;
}
