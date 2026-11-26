import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PlatformSettingsDto } from './dto/settings.dto.js';

const KEY = 'global';

export const DEFAULT_SETTINGS: PlatformSettingsDto = {
  deliveryFee: 150,
  platformCommissionPercent: 10,
  doctorCommissionPercent: 15,
  riderFeePercent: 80,
  serviceCities: ['Lahore', 'Karachi', 'Islamabad'],
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettingsDto> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: KEY } });
    return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<PlatformSettingsDto>) ?? {}) };
  }

  async update(settings: PlatformSettingsDto): Promise<PlatformSettingsDto> {
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.prisma.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value },
      update: { value },
    });
    return this.get();
  }
}
