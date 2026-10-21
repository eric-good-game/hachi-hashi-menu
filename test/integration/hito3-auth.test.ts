import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { createTestApp } from './support/app';
import { runMigrations, startPostgres } from './support/containers';
import { createPrisma, resetDatabase } from './support/db';
import { generateJwtKeyPair, signJwt, type JwtKeyPair } from './support/jwt';

function categoryName(): string {
  return `Categoría ${randomUUID()}`;
}

async function createCategory(app: INestApplication, token?: string): Promise<request.Response> {
  const pending = request(app.getHttpServer())
    .post('/api/menu/admin/categories')
    .send({ name: categoryName(), displayOrder: 1 });

  if (token) {
    pending.set('Authorization', `Bearer ${token}`);
  }

  return pending;
}

describe('Hito 3 — JWT y herramientas de desarrollo deshabilitadas', () => {
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let app: INestApplication;
  let keys: JwtKeyPair;
  let otherKeys: JwtKeyPair;
  let keyDir: string;

  before(async () => {
    postgres = await startPostgres();
    runMigrations(postgres.getConnectionUri());

    keyDir = join(process.cwd(), 'var', `integration-jwt-${randomUUID()}`);
    mkdirSync(keyDir, { recursive: true });
    keys = generateJwtKeyPair();
    otherKeys = generateJwtKeyPair();
    const publicKeyFile = join(keyDir, 'public.pem');
    writeFileSync(publicKeyFile, keys.publicKey, 'utf8');

    process.env.NODE_ENV = 'test';
    process.env.APP_MODE = 'integrated';
    process.env.AUTH_MODE = 'jwt';
    process.env.DEV_TOOLS_ENABLED = 'false';
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.JWT_PUBLIC_KEY_FILE = publicKeyFile;
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.RABBITMQ_URL;
    process.env.OUTBOX_PUBLISH_ENABLED = 'false';
    process.env.CONSUMERS_ENABLED = 'false';
    process.env.SEED_ON_START = 'false';
    process.env.PHOTO_STORAGE_PATH = join(process.cwd(), 'var', `integration-photos-${randomUUID()}`);
    process.env.PORT = '3000';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';

    prisma = createPrisma(postgres.getConnectionUri());
    await resetDatabase(prisma);
    app = await createTestApp();
  });

  after(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await postgres?.stop();
    rmSync(keyDir, { recursive: true, force: true });
  });

  it('rechaza una petición sin token', async () => {
    const response = await createCategory(app);
    assert.equal(response.status, 401);
  });

  it('rechaza un token de desarrollo cuando AUTH_MODE=jwt', async () => {
    const response = await createCategory(app, 'dev-admin-token');
    assert.equal(response.status, 401);
  });

  it('rechaza a un usuario con rol viewer', async () => {
    const token = signJwt(keys.privateKey, { sub: 'viewer-1', roles: ['viewer'] }, { expiresIn: '5m' });
    const response = await createCategory(app, token);
    assert.equal(response.status, 403);
  });

  it('acepta a un administrador con rol en el claim roles', async () => {
    const token = signJwt(keys.privateKey, { sub: 'admin-1', roles: ['admin'] }, { expiresIn: '5m' });
    const response = await createCategory(app, token);
    assert.equal(response.status, 201);
    assert.equal(response.body.name.startsWith('Categoría '), true);
  });

  it('acepta roles anidados en realm_access', async () => {
    const token = signJwt(
      keys.privateKey,
      { sub: 'admin-2', realm_access: { roles: ['admin'] } },
      { expiresIn: '5m' },
    );
    const response = await createCategory(app, token);
    assert.equal(response.status, 201);
  });

  it('rechaza un token expirado', async () => {
    const token = signJwt(keys.privateKey, { sub: 'admin-3', roles: ['admin'] }, { expiresIn: -10 });
    const response = await createCategory(app, token);
    assert.equal(response.status, 401);
  });

  it('rechaza un token firmado con otra clave', async () => {
    const token = signJwt(otherKeys.privateKey, { sub: 'admin-4', roles: ['admin'] }, { expiresIn: '5m' });
    const response = await createCategory(app, token);
    assert.equal(response.status, 401);
  });

  it('rechaza un token sin sub', async () => {
    const token = signJwt(keys.privateKey, { roles: ['admin'] }, { expiresIn: '5m' });
    const response = await createCategory(app, token);
    assert.equal(response.status, 401);
  });

  it('oculta el endpoint dev cuando DEV_TOOLS_ENABLED=false', async () => {
    const token = signJwt(keys.privateKey, { sub: 'admin-5', roles: ['admin'] }, { expiresIn: '5m' });
    const response = await request(app.getHttpServer())
      .put(`/api/menu/dev/items/${randomUUID()}/availability`)
      .set('Authorization', `Bearer ${token}`)
      .send({ available: false });

    assert.equal(response.status, 404);
  });
});
