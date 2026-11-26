import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtVerifier } from '@nestjs/authentication';
import type { Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service.js';
import { authUserSelect, type AuthUser } from './auth-user.js';

interface SocketData {
  userId?: string;
  auth?: Promise<AuthUser | null>;
}

/**
 * Authenticates Socket.IO connections. Clients send the access token as
 * `io(url, { auth: { token } })` (or an `Authorization: Bearer` header).
 * Gateways call `authenticate()` in handleConnection and `currentUser()`
 * before acting on an event, so a suspended or deleted user loses access
 * mid-connection.
 */
@Injectable()
export class SocketAuthService {
  private readonly verifier: JwtVerifier;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.verifier = new JwtVerifier({ key: config.getOrThrow<string>('JWT_SECRET') });
  }

  async authenticate(socket: Socket): Promise<AuthUser | null> {
    // Events can arrive before this async check finishes (the client sees `connect` first):
    // keep the pending check on the socket so currentUser() waits for it.
    const pending = this.resolveHandshake(socket);
    (socket.data as SocketData).auth = pending;
    return pending;
  }

  private async resolveHandshake(socket: Socket): Promise<AuthUser | null> {
    const token = this.extractToken(socket);
    if (!token) return null;
    const user = await this.userFromAccessToken(token);
    if (user) (socket.data as SocketData).userId = user.id;
    return user;
  }

  /** The user an access token belongs to, or null when the token is invalid/expired. */
  async userFromAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const claims = await this.verifier.verify(token);
      return claims.sub ? await this.loadUser(claims.sub) : null;
    } catch {
      return null;
    }
  }

  /** Re-loads the socket's user from the database; null when access was lost. */
  async currentUser(socket: Socket): Promise<AuthUser | null> {
    const data = socket.data as SocketData;
    await data.auth;
    return data.userId ? this.loadUser(data.userId) : null;
  }

  private async loadUser(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: authUserSelect });
    if (!user || user.status === 'SUSPENDED') return null;
    return user;
  }

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    if (typeof auth?.token === 'string' && auth.token) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return null;
  }
}
