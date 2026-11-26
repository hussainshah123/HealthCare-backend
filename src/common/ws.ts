import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

export type WsAck<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Validates a Socket.IO payload with the same class-validator DTOs as HTTP.
 * Returns the DTO, or an error message to send back in the ack.
 */
export async function parseWsPayload<T extends object>(
  cls: ClassConstructor<T>,
  payload: unknown,
): Promise<{ dto: T } | { error: string }> {
  if (typeof payload !== 'object' || payload === null) return { error: 'Invalid payload' };
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    return {
      error: errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ') || 'Invalid payload',
    };
  }
  return { dto };
}

/** CORS origins for Socket.IO gateways (same list as HTTP). */
export function socketCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Something went wrong';
}
