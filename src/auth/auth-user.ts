import type { AccountStatus, Role } from '../generated/prisma/enums.js';

/** The signed-in user, loaded from the database on every request. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: AccountStatus;
  avatarUrl: string | null;
  createdAt: Date;
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: AuthUser;
  }
}

/** Columns that make an AuthUser: never select passwordHash outside the auth service. */
export const authUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  avatarUrl: true,
  createdAt: true,
} as const;

export class UserResponseDto {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: AccountStatus;
  avatarUrl: string | null;
  createdAt: Date;

  static from(user: AuthUser): UserResponseDto {
    return Object.assign(new UserResponseDto(), {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });
  }
}
