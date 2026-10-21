import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}, z.boolean());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['standalone', 'integrated']).default('standalone'),
    AUTH_MODE: z.enum(['dev', 'jwt']).default('dev'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

    OUTBOX_PUBLISH_ENABLED: booleanFromEnv.default(false),
    CONSUMERS_ENABLED: booleanFromEnv.default(false),
    RABBITMQ_URL: z.string().optional(),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
    OUTBOX_RELAY_LOCK_ENABLED: booleanFromEnv.default(true),
    OUTBOX_RELAY_LEASE_MS: z.coerce.number().int().positive().default(15000),
    OUTBOX_RELAY_INSTANCE_ID: z.string().min(1).max(120).optional(),
    CONSUMER_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    RABBITMQ_RETRY_TTLS_MS: z
      .string()
      .default('5000,15000,45000')
      .transform((value) => value.split(',').map((part) => Number(part.trim())))
      .pipe(z.array(z.number().int().positive()).length(3)),

    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_PUBLIC_KEY_FILE: z.string().optional(),

    DEV_TOOLS_ENABLED: booleanFromEnv.default(true),
    SEED_ON_START: booleanFromEnv.default(false),
    PHOTO_STORAGE_PATH: z.string().default('./var/photos'),
    METRICS_ENABLED: booleanFromEnv.default(true),
    QUEUE_METRICS_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };

    if (env.APP_MODE === 'integrated' && env.AUTH_MODE === 'dev') {
      fail('AUTH_MODE', 'APP_MODE=integrated exige AUTH_MODE=jwt');
    }
    if (env.APP_MODE === 'integrated' && env.DEV_TOOLS_ENABLED) {
      fail('DEV_TOOLS_ENABLED', 'APP_MODE=integrated exige DEV_TOOLS_ENABLED=false');
    }
    if ((env.OUTBOX_PUBLISH_ENABLED || env.CONSUMERS_ENABLED) && !env.RABBITMQ_URL) {
      fail('RABBITMQ_URL', 'El relay o los consumidores requieren RABBITMQ_URL');
    }
    if (env.AUTH_MODE === 'jwt' && !env.JWT_PUBLIC_KEY && !env.JWT_PUBLIC_KEY_FILE) {
      fail('JWT_PUBLIC_KEY', 'AUTH_MODE=jwt exige JWT_PUBLIC_KEY o JWT_PUBLIC_KEY_FILE');
    }
    if (env.OUTBOX_RELAY_LOCK_ENABLED && env.OUTBOX_RELAY_LEASE_MS < env.OUTBOX_POLL_INTERVAL_MS) {
      fail(
        'OUTBOX_RELAY_LEASE_MS',
        'OUTBOX_RELAY_LEASE_MS debe ser mayor o igual que OUTBOX_POLL_INTERVAL_MS',
      );
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración inválida: ${details}`);
  }
  return result.data;
}
