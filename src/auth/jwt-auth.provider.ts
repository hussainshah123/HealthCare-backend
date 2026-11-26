import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { PrismaService } from '../prisma/prisma.service.js';
import { authUserSelect, type AuthUser } from './auth-user.js';

/** Verifies `Authorization: Bearer <jwt>` and loads the current user on every request. */
@Injectable()
export class JwtAuth extends JwtBearerProvider<AuthUser> {
  constructor(
    private readonly prisma: PrismaService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this, { order: 1 });
  }

  async validate({ sub }: JwtClaims): Promise<AuthUser | null> {
    if (!sub) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: authUserSelect,
    });
    // Suspended accounts lose access immediately, even with a valid token.
    if (!user || user.status === 'SUSPENDED') return null;
    return user;
  }
}
