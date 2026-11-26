/**
 * Fails fast at startup when required environment variables are missing.
 */
export function validateEnv(config: Record<string, unknown>) {
  const errors: string[] = [];
  if (!config.DATABASE_URL) errors.push('DATABASE_URL is required');
  const secret = config.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    errors.push(
      'JWT_SECRET must be at least 32 bytes (generate one with: openssl rand -base64 32)',
    );
  }
  if (errors.length) throw new Error(`Invalid environment:\n- ${errors.join('\n- ')}`);
  return config;
}
