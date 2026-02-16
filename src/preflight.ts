/**
 * Pre-flight checks — run before any subsystem starts.
 * Validates that required secrets are set and non-trivial.
 */
import { logger } from './logger.js';

const REQUIRED_SECRETS = ['OS_HTTP_SECRET'] as const;

const MIN_SECRET_LENGTH = 16;

export function runPreflight(): void {
  const missing = REQUIRED_SECRETS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required secrets: ${missing.join(', ')}. Refusing to start.`,
    );
  }

  for (const k of REQUIRED_SECRETS) {
    const val = process.env[k]!;
    if (val.length < MIN_SECRET_LENGTH) {
      logger.warn(
        { key: k, length: val.length, minimum: MIN_SECRET_LENGTH },
        'Secret is shorter than recommended minimum — consider rotating',
      );
    }
  }
}
