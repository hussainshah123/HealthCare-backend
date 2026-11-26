import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { IsOptionalField } from './validation.js';

export class PaginationQueryDto {
  @IsOptionalField()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptionalField()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function pageArgs(query: { page: number; limit: number }) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export function paginated<T>(
  items: T[],
  total: number,
  query: { page: number; limit: number },
): Paginated<T> {
  return { items, total, page: query.page, limit: query.limit };
}
