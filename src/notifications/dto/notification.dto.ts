import { IsIn, IsString, Length } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @Length(10, 4096)
  token: string;

  @IsIn(['android', 'ios'])
  platform: 'android' | 'ios';
}

export class NotificationResponseDto {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}
