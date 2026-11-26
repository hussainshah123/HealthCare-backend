import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuth } from './jwt-auth.provider.js';
import { PrismaRefreshTokenStore } from './prisma-refresh-token.store.js';
import { RolesPolicy } from './roles.policy.js';
import { SocketAuthService } from './socket-auth.service.js';

@Module({
  imports: [PrismaModule, GeoModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuth, PrismaRefreshTokenStore, SocketAuthService, RolesPolicy],
  exports: [SocketAuthService, RolesPolicy],
})
export class AuthModule {}
