/** Prisma Decimal (or anything with toString) → number rounded to 2 decimals. */
export function toMoney(value: { toString(): string } | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value.toString()) * 100) / 100;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
