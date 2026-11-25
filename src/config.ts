//Lee y valida variables de entorno para que no haya valores hardcodeados

import dotenv from 'dotenv';

dotenv.config();

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  port: parsePositiveInt(process.env.PORT, 3000),
  catalogBaseUrl: (process.env.CATALOG_BASE_URL || 'https://dummyjson.com/products').replace(/\/$/, ''),
  catalogTimeoutMs: parsePositiveInt(process.env.CATALOG_TIMEOUT_MS, 3000),
  catalogDelayMs: parsePositiveInt(process.env.CATALOG_DELAY_MS, 0),
} as const;