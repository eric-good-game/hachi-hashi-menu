import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppEnv } from '../../src/config/env.schema';
import type { EventBusPort } from '../../src/catalog/application/ports/event-bus';
import type { ClockPort } from '../../src/catalog/application/ports/system';
import { PrismaOutboxRepository } from '../../src/catalog/infrastructure/persistence/prisma-outbox.repository';
import { ContractValidator } from '../../src/events/contract-validator';
import { OutboxRelay } from '../../src/messaging/application/outbox-relay.service';
import { PrismaRelayLockRepository } from '../../src/messaging/infrastructure/prisma-relay-lock.repository';
import { MetricsService } from '../../src/observability/metrics.service';
import { runMigrations, startPostgres } from './support/containers';
import { createPrisma, resetDatabase } from './support/db';

const EVENT_COUNT = 20;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function relayEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    OUTBOX_PUBLISH_ENABLED: true,
    OUTBOX_BATCH_SIZE: 50,
    OUTBOX_POLL_INTERVAL_MS: 50,
    OUTBOX_RELAY_LOCK_ENABLED: true,
    OUTBOX_RELAY_LEASE_MS: 5_000,
    ...overrides,
  } as AppEnv;
}

/**
 * Bus compartido que retrasa cada publicación. El retraso abre de par en par la
 * ventana de carrera: dos relays sin bloqueo listan el mismo lote antes de que
 * ninguno lo marque como publicado, lo que produce duplicados.
 */
function slowBus(delayMs: number): EventBusPort & { published: string[] } {
  const published: string[] = [];
  return {
    published,
    async publish(_routingKey: string, envelope: { messageId: string }): Promise<void> {
      await sleep(delayMs);
      published.push(envelope.messageId);
    },
  };
}

function buildRelay(
  prisma: PrismaClient,
  bus: EventBusPort,
  env: AppEnv,
): OutboxRelay {
  const clock: ClockPort = { now: () => new Date() };
  return new OutboxRelay(
    new PrismaOutboxRepository(prisma),
    bus,
    clock,
    env,
    new ContractValidator(),
    new PrismaRelayLockRepository(prisma),
    new MetricsService(),
  );
}

/** Conduce ambos relays en paralelo hasta que el Outbox quede vacío. */
async function drain(
  relays: OutboxRelay[],
  prisma: PrismaClient,
  rounds = 200,
): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.all(relays.map((relay) => relay.pollOnce()));
    const pending = await prisma.outboxEvent.count({ where: { publishedAt: null } });
    if (pending === 0) {
      return;
    }
  }
  throw new Error('El Outbox no se vació a tiempo');
}

async function seedEvents(prisma: PrismaClient): Promise<void> {
  await prisma.outboxEvent.createMany({
    data: Array.from({ length: EVENT_COUNT }, () => ({
      id: randomUUID(),
      type: 'MenuItemUpdated',
      routingKey: 'menu.menu-item-updated',
      aggregateId: randomUUID(),
      correlationId: randomUUID(),
      causationId: null,
      version: 1,
      payload: {
        menuItemId: randomUUID(),
        revision: 1,
        name: 'Platillo de prueba',
        priceCents: 1_000,
        currency: 'MXN',
        categoryId: randomUUID(),
        categoryName: 'Categoría de prueba',
        active: true,
      },
      occurredAt: new Date(),
    })),
  });
}

describe('Hito 4 — bloqueo del relay multi-instancia', () => {
  let postgres: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  before(async () => {
    postgres = await startPostgres();
    runMigrations(postgres.getConnectionUri());
    prisma = createPrisma(postgres.getConnectionUri());
  });

  after(async () => {
    await prisma?.$disconnect();
    await postgres?.stop();
  });

  it('otorga el lease a una sola instancia y lo cede al expirar', async () => {
    await resetDatabase(prisma);
    const lock = new PrismaRelayLockRepository(prisma);
    const name = `outbox-relay-${randomUUID()}`;

    assert.equal(await lock.acquire(name, 'instancia-a', 500), true);
    assert.equal(await lock.acquire(name, 'instancia-b', 500), false);
    // La misma instancia puede renovarlo aunque el lease esté vigente.
    assert.equal(await lock.acquire(name, 'instancia-a', 500), true);

    await sleep(700);

    // El lease expiró (instancia caída): otra puede tomar el relevo.
    assert.equal(await lock.acquire(name, 'instancia-b', 500), true);
    assert.equal(await lock.acquire(name, 'instancia-a', 500), false);

    // Liberarlo lo deja disponible de inmediato.
    await lock.release(name, 'instancia-b');
    assert.equal(await lock.acquire(name, 'instancia-a', 500), true);
  });

  it('con el bloqueo activo, dos relays publican cada evento exactamente una vez', async () => {
    await resetDatabase(prisma);
    await seedEvents(prisma);

    const bus = slowBus(30);
    const env = relayEnv({ OUTBOX_RELAY_LOCK_ENABLED: true });
    const relays = [buildRelay(prisma, bus, env), buildRelay(prisma, bus, env)];

    await drain(relays, prisma);

    assert.equal(bus.published.length, EVENT_COUNT, 'se publica cada evento una sola vez');
    assert.equal(new Set(bus.published).size, EVENT_COUNT, 'no hay eventos duplicados');
    assert.equal(
      await prisma.outboxEvent.count({ where: { publishedAt: { not: null } } }),
      EVENT_COUNT,
    );
  });

  it('sin bloqueo, dos relays publicarían duplicados (la prueba anterior no es vacía)', async () => {
    await resetDatabase(prisma);
    await seedEvents(prisma);

    const bus = slowBus(30);
    const env = relayEnv({ OUTBOX_RELAY_LOCK_ENABLED: false });
    const relays = [buildRelay(prisma, bus, env), buildRelay(prisma, bus, env)];

    await drain(relays, prisma);

    assert.ok(
      bus.published.length > EVENT_COUNT,
      `se esperaban duplicados sin bloqueo, pero se publicaron ${bus.published.length}`,
    );
    assert.ok(new Set(bus.published).size <= EVENT_COUNT);
  });
});
