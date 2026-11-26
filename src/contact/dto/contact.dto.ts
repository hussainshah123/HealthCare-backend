import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsOptionalField } from '../../common/validation.js';

export const CONTACT_TOPICS = ['CUSTOMER', 'PHARMACY', 'DOCTOR', 'RIDER', 'OTHER'] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
/** Empty strings from optional form fields count as "not given". */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : trim({ value });

export class CreateContactMessageDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @Transform(lowerTrim)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(emptyToUndefined)
  @IsOptionalField()
  @Matches(/^\+?[0-9 -]{10,18}$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsIn(CONTACT_TOPICS)
  topic: ContactTopic;

  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  message: string;
}

export class ContactMessageResponseDto {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  handled: boolean;
  createdAt: Date;
}
