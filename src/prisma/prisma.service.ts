import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    // `prisma dev` (local Postgres) serves one connection at a time: parallel
    // connections get their queries mixed up ("bind message supplies 2
    // parameters…") and requests fail at random. Set DATABASE_POOL_MAX=1 for it
    // so queries queue instead. Leave it unset for a real Postgres server.
    const poolMax = Number(config.get<string>('DATABASE_POOL_MAX'));
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        ...(Number.isInteger(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
      }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
