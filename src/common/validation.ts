import { ValidateIf } from 'class-validator';

/**
 * The field may be left out, but when present it must pass the other rules.
 * Unlike @IsOptional(), it does not let `null` through.
 */
export const IsOptionalField = () =>
  ValidateIf((_object: object, value: unknown) => value !== undefined);
