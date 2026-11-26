import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PasswordHasher, TokenService } from '@nestjs/authentication';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { GeoService } from '../geo/geo.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { authUserSelect, UserResponseDto, type AuthUser } from './auth-user.js';
import type { AuthResponseDto, LoginDto, RegisterDto } from './dto/auth.dto.js';
import { SocketAuthService } from './socket-auth.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly accessTokens: SocketAuthService,
    private readonly geo: GeoService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const point = dto.lat !== undefined && dto.lng !== undefined ? { lat: dto.lat, lng: dto.lng } : null;
    // Geocoding is best-effort and runs alongside hashing; sign-up never fails because of it.
    const [passwordHash, place] = await Promise.all([
      this.passwordHasher.hash(dto.password),
      point ? this.geo.reverse(point.lat, point.lng) : Promise.resolve(null),
    ]);
    let user: AuthUser;
    try {
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          role: dto.role,
          // Customers can use the app at once; professionals wait for admin approval.
          status: dto.role === 'CUSTOMER' ? 'ACTIVE' : 'PENDING',
          ...(point ? { ...point, city: place?.city ?? null, locationUpdatedAt: new Date() } : {}),
          ...this.profileFor(dto, point),
          // Customers get their sign-up location as a ready-to-use delivery address (editable later).
          ...(point && dto.role === 'CUSTOMER'
            ? {
                addresses: {
                  create: {
                    label: 'Home',
                    line1: place?.line1 ?? `Pinned location (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`,
                    city: place?.city ?? 'Unknown',
                    ...point,
                    isDefault: true,
                  },
                },
              }
            : {}),
        },
        select: authUserSelect,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email or phone already exists');
      }
      throw error;
    }
    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const found = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...authUserSelect, passwordHash: true },
    });
    // verify() checks a dummy hash when there is no user, so timing does not reveal registered emails.
    const valid = await this.passwordHasher.verify(dto.password, found?.passwordHash);
    if (!valid || !found) throw new UnauthorizedException('Invalid email or password');

    const { passwordHash, ...user } = found;
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended. Please contact support.');
    }
    if (this.passwordHasher.needsRehash(passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwordHasher.hash(dto.password) },
      });
    }
    return this.issue(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    const pair = await this.tokens.refresh(refreshToken); // 401 when invalid, expired or reused
    const user = await this.accessTokens.userFromAccessToken(pair.accessToken);
    if (!user) {
      await this.tokens.revoke(pair.refreshToken);
      throw new UnauthorizedException('Account is no longer available');
    }
    return { ...pair, user: UserResponseDto.from(user) };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken); // same answer for unknown tokens (RFC 7009)
  }

  private async issue(user: AuthUser): Promise<AuthResponseDto> {
    const tokens = await this.tokens.issue(user.id, { method: 'password' });
    return { ...tokens, user: UserResponseDto.from(user) };
  }

  private profileFor(dto: RegisterDto, point: { lat: number; lng: number } | null) {
    switch (dto.role) {
      case 'CUSTOMER':
        return { customerProfile: { create: {} } };
      case 'DOCTOR':
        return { doctorProfile: { create: {} } };
      case 'RIDER':
        return {
          riderProfile: {
            create: point ? { lastLat: point.lat, lastLng: point.lng, lastSeenAt: new Date() } : {},
          },
        };
      case 'PHARMACY':
        return { pharmacyProfile: { create: { name: dto.name, ...point } } };
    }
  }
}
