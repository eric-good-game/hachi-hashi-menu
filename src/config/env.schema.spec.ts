import { envSchema, validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://menu:menu@localhost:5433/menu?schema=public',
};

describe('envSchema', () => {
  it('aplica valores por defecto de standalone', () => {
    const env = validateEnv(base);

    expect(env.APP_MODE).toBe('standalone');
    expect(env.AUTH_MODE).toBe('dev');
    expect(env.DEV_TOOLS_ENABLED).toBe(true);
    expect(env.SEED_ON_START).toBe(false);
    expect(env.OUTBOX_PUBLISH_ENABLED).toBe(false);
  });

  it('interpreta banderas booleanas desde texto', () => {
    const env = envSchema.parse({
      ...base,
      SEED_ON_START: 'true',
      DEV_TOOLS_ENABLED: 'false',
    });

    expect(env.SEED_ON_START).toBe(true);
    expect(env.DEV_TOOLS_ENABLED).toBe(false);
  });

  it('rechaza integrado con autenticación dev', () => {
    const result = envSchema.safeParse({
      ...base,
      APP_MODE: 'integrated',
      AUTH_MODE: 'dev',
      DEV_TOOLS_ENABLED: 'false',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'AUTH_MODE')).toBe(true);
  });

  it('rechaza integrado con herramientas de desarrollo', () => {
    const result = envSchema.safeParse({
      ...base,
      APP_MODE: 'integrated',
      AUTH_MODE: 'dev',
      DEV_TOOLS_ENABLED: 'true',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza el relay sin RABBITMQ_URL', () => {
    const result = envSchema.safeParse({
      ...base,
      OUTBOX_PUBLISH_ENABLED: 'true',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'RABBITMQ_URL')).toBe(true);
  });

  it('acepta relay y consumidores con RABBITMQ_URL', () => {
    const env = envSchema.parse({
      ...base,
      OUTBOX_PUBLISH_ENABLED: 'true',
      CONSUMERS_ENABLED: 'true',
      RABBITMQ_URL: 'amqp://menu:menu@localhost:5672',
    });

    expect(env.OUTBOX_PUBLISH_ENABLED).toBe(true);
    expect(env.CONSUMERS_ENABLED).toBe(true);
  });

  it('aplica los TTL de reintento por defecto', () => {
    const env = validateEnv(base);

    expect(env.RABBITMQ_RETRY_TTLS_MS).toEqual([5_000, 15_000, 45_000]);
  });

  it('parsea TTL de reintento personalizados', () => {
    const env = envSchema.parse({
      ...base,
      RABBITMQ_RETRY_TTLS_MS: '100,200,300',
    });

    expect(env.RABBITMQ_RETRY_TTLS_MS).toEqual([100, 200, 300]);
  });

  it('rechaza TTL de reintento que no sean tres enteros positivos', () => {
    const result = envSchema.safeParse({
      ...base,
      RABBITMQ_RETRY_TTLS_MS: '100,200',
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.join('.') === 'RABBITMQ_RETRY_TTLS_MS'),
    ).toBe(true);
  });

  it('exige una clave pública cuando AUTH_MODE=jwt', () => {
    const result = envSchema.safeParse({
      ...base,
      AUTH_MODE: 'jwt',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'JWT_PUBLIC_KEY')).toBe(true);
  });

  it('acepta JWT con clave pública en configuración', () => {
    const env = envSchema.parse({
      ...base,
      AUTH_MODE: 'jwt',
      JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\ntest\\n-----END PUBLIC KEY-----',
    });

    expect(env.AUTH_MODE).toBe('jwt');
  });

  it('activa el lease del relay por defecto', () => {
    const env = validateEnv(base);

    expect(env.OUTBOX_RELAY_LOCK_ENABLED).toBe(true);
    expect(env.OUTBOX_RELAY_LEASE_MS).toBe(15_000);
    expect(env.OUTBOX_RELAY_INSTANCE_ID).toBeUndefined();
  });

  it('rechaza un lease más corto que el intervalo de sondeo', () => {
    const result = envSchema.safeParse({
      ...base,
      OUTBOX_POLL_INTERVAL_MS: '5000',
      OUTBOX_RELAY_LEASE_MS: '1000',
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((issue) => issue.path.join('.') === 'OUTBOX_RELAY_LEASE_MS'),
    ).toBe(true);
  });

  it('permite un lease corto si el bloqueo está deshabilitado', () => {
    const env = envSchema.parse({
      ...base,
      OUTBOX_RELAY_LOCK_ENABLED: 'false',
      OUTBOX_POLL_INTERVAL_MS: '5000',
      OUTBOX_RELAY_LEASE_MS: '1000',
    });

    expect(env.OUTBOX_RELAY_LOCK_ENABLED).toBe(false);
  });
});
