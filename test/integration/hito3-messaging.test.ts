import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import request from 'supertest';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import { AVAILABILITY_INBOUND } from '../../src/catalog/catalog.tokens';
import {
  AVAILABILITY_DLQ,
  AVAILABILITY_ROUTING_KEY,
  EVENTS_EXCHANGE,
} from '../../src/messaging/infrastructure/rabbitmq/rabbitmq.constants';
import { createTestApp } from './support/app';
import { runMigrations, startPostgres, startRabbitMq } from './support/containers';
import { createPrisma, resetDatabase } from './support/db';
import {
  bindQueue,
  connectRabbit,
  consumeOne,
  deleteQueue,
  publishEnvelope,
  purgeAvailabilityQueues,
  queueDepth,
  waitForTopology,
} from './support/rabbit';
import { waitFor } from './support/wait';

const ADMIN_AUTH = 'Bearer dev-admin-token';

interface AvailabilityEvent {
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
  source: string;
  correlationId: string;
  causationId: string | null;
  payload: {
    menuItemId: string;
    available: boolean;
  };
}

function availabilityEnvelope(input: {
  messageId?: string;
  menuItemId: string;
  available: boolean;
  occurredAt: string;
}): AvailabilityEvent {
  return {
    messageId: input.messageId ?? randomUUID(),
    type: 'MenuItemAvailabilityChanged',
    version: 1,
    occurredAt: input.occurredAt,
    source: 'inventory',
    correlationId: randomUUID(),
    causationId: null,
    payload: {
      menuItemId: input.menuItemId,
      available: input.available,
    },
  };
}

async function publishAvailability(
  channel: ConfirmChannel,
  input: { messageId?: string; menuItemId: string; available: boolean; occurredAt: string },
): Promise<AvailabilityEvent> {
  const envelope = availabilityEnvelope(input);
  await publishEnvelope(channel, EVENTS_EXCHANGE, AVAILABILITY_ROUTING_KEY, envelope);
  return envelope;
}

async function createActiveItem(app: INestApplication): Promise<{ itemId: string; revision: number }> {
  const suffix = randomUUID();
  const server = app.getHttpServer();

  const category = await request(server)
    .post('/api/menu/admin/categories')
    .set('Authorization', ADMIN_AUTH)
    .send({ name: `Categoría ${suffix}`, displayOrder: 1 })
    .expect(201);

  const item = await request(server)
    .post('/api/menu/admin/items')
    .set('Authorization', ADMIN_AUTH)
    .send({
      categoryId: category.body.id as string,
      name: `Platillo ${suffix}`,
      description: 'Prueba de integración del Hito 3',
      priceCents: 1_000,
      displayOrder: 1,
    })
    .expect(201);

  await request(server)
    .put(`/api/menu/admin/items/${item.body.id as string}/allergens`)
    .set('Authorization', ADMIN_AUTH)
    .send({ allergenCodes: [] })
    .expect(200);

  const activated = await request(server)
    .patch(`/api/menu/admin/items/${item.body.id as string}/status`)
    .set('Authorization', ADMIN_AUTH)
    .send({ active: true, revision: 1 })
    .expect(200);

  return { itemId: item.body.id as string, revision: activated.body.revision as number };
}

async function waitForPublicAvailability(
  app: INestApplication,
  itemId: string,
  expected: boolean,
): Promise<void> {
  await waitFor(
    async () => {
      const response = await request(app.getHttpServer()).get(`/api/menu/items/${itemId}`);
      return response.body.available as boolean | undefined;
    },
    (available) => available === expected,
    { description: `disponibilidad pública ${expected}` },
  );
}

async function waitForProcessed(prisma: PrismaClient, messageId: string): Promise<void> {
  await waitFor(
    () => prisma.processedMessage.findUnique({ where: { messageId } }),
    (row) => row !== null,
    { description: `processed_message ${messageId}` },
  );
}

describe('Hito 3 — mensajería, consumidor y reintentos', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let prisma: PrismaClient;
  let connection: ChannelModel;
  let channel: ConfirmChannel;

  before(async () => {
    postgres = await startPostgres();
    rabbit = await startRabbitMq();
    runMigrations(postgres.getConnectionUri());

    process.env.NODE_ENV = 'test';
    process.env.APP_MODE = 'standalone';
    process.env.AUTH_MODE = 'dev';
    process.env.DEV_TOOLS_ENABLED = 'true';
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.RABBITMQ_URL = rabbit.getAmqpUrl();
    process.env.OUTBOX_PUBLISH_ENABLED = 'true';
    process.env.CONSUMERS_ENABLED = 'true';
    process.env.OUTBOX_POLL_INTERVAL_MS = '50';
    process.env.OUTBOX_BATCH_SIZE = '50';
    process.env.CONSUMER_MAX_RETRIES = '3';
    process.env.RABBITMQ_RETRY_TTLS_MS = '100,200,300';
    process.env.SEED_ON_START = 'false';
    process.env.PHOTO_STORAGE_PATH = join(process.cwd(), 'var', `integration-photos-${randomUUID()}`);
    process.env.PORT = '3000';
    process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
    delete process.env.JWT_PUBLIC_KEY;
    delete process.env.JWT_PUBLIC_KEY_FILE;

    prisma = createPrisma(postgres.getConnectionUri());
    ({ connection, channel } = await connectRabbit(rabbit.getAmqpUrl()));
  });

  after(async () => {
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await prisma?.$disconnect();
    await rabbit?.stop();
    await postgres?.stop();
  });

  it('publica MenuItemUpdated y marca el Outbox', async () => {
    await resetDatabase(prisma);
    const app = await createTestApp();
    const queue = `test.menu-updated.${randomUUID()}`;

    try {
      await waitForTopology(connection);
      await purgeAvailabilityQueues(channel);
      await bindQueue(channel, EVENTS_EXCHANGE, 'menu.menu-item-updated', queue);

      const { itemId } = await createActiveItem(app);
      const received = await consumeOne(channel, queue, 15_000);
      const event = received.body as {
        messageId: string;
        type: string;
        source: string;
        payload: { menuItemId: string; revision: number; active: boolean };
      };

      assert.equal(received.routingKey, 'menu.menu-item-updated');
      assert.equal(event.type, 'MenuItemUpdated');
      assert.equal(event.source, 'menu');
      assert.equal(event.payload.menuItemId, itemId);
      assert.equal(event.payload.revision, 1);
      assert.equal(event.payload.active, false);

      await waitFor(
        () => prisma.outboxEvent.findUnique({ where: { id: event.messageId } }),
        (row) => row?.publishedAt !== null && row?.publishedAt !== undefined,
        { description: 'Outbox marcado como publicado' },
      );
    } finally {
      await app.close();
      await deleteQueue(channel, queue);
    }
  });

  it('aplica disponibilidad, es idempotente, descarta viejos y confirma desconocidos', async () => {
    await resetDatabase(prisma);
    const app = await createTestApp();

    try {
      await waitForTopology(connection);
      await purgeAvailabilityQueues(channel);
      const { itemId, revision } = await createActiveItem(app);
      const newer = new Date(Date.now() + 3_600_000).toISOString();
      const older = new Date(Date.now() - 3_600_000).toISOString();

      const first = await publishAvailability(channel, {
        menuItemId: itemId,
        available: false,
        occurredAt: newer,
      });
      await waitForPublicAvailability(app, itemId, false);
      await waitForProcessed(prisma, first.messageId);

      const afterFirst = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
      assert.equal(afterFirst.available, false);
      assert.equal(afterFirst.revision, revision);
      assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: itemId } }), 2);

      // Mismo messageId con payload distinto: no debe volver a aplicarse.
      await publishAvailability(channel, {
        messageId: first.messageId,
        menuItemId: itemId,
        available: true,
        occurredAt: newer,
      });
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
      const afterDuplicate = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
      assert.equal(afterDuplicate.available, false);
      assert.equal(await prisma.processedMessage.count({ where: { messageId: first.messageId } }), 1);

      const stale = await publishAvailability(channel, {
        menuItemId: itemId,
        available: true,
        occurredAt: older,
      });
      await waitForProcessed(prisma, stale.messageId);
      const afterStale = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
      assert.equal(afterStale.available, false);

      const applied = await publishAvailability(channel, {
        menuItemId: itemId,
        available: true,
        occurredAt: new Date(Date.now() + 7_200_000).toISOString(),
      });
      await waitForPublicAvailability(app, itemId, true);
      await waitForProcessed(prisma, applied.messageId);

      const unknownMessageId = randomUUID();
      const unknown = await publishAvailability(channel, {
        messageId: unknownMessageId,
        menuItemId: randomUUID(),
        available: false,
        occurredAt: new Date(Date.now() + 10_800_000).toISOString(),
      });
      await waitForProcessed(prisma, unknown.messageId);
    } finally {
      await app.close();
    }
  });

  it('manda a la DLQ un mensaje que no cumple el contrato', async () => {
    await resetDatabase(prisma);
    const app = await createTestApp();

    try {
      await waitForTopology(connection);
      await purgeAvailabilityQueues(channel);
      await publishEnvelope(channel, EVENTS_EXCHANGE, AVAILABILITY_ROUTING_KEY, {
        messageId: randomUUID(),
        type: 'EventoDesconocido',
        version: 1,
        occurredAt: new Date().toISOString(),
        source: 'inventory',
        correlationId: randomUUID(),
        causationId: null,
        payload: { menuItemId: randomUUID(), available: false },
      });

      await waitFor(
        () => queueDepth(channel, AVAILABILITY_DLQ),
        (depth) => depth >= 1,
        { description: 'mensaje en la DLQ', timeoutMs: 15_000 },
      );
    } finally {
      await app.close();
    }
  });

  it('reintenta con TTL creciente y termina en la DLQ', async () => {
    await resetDatabase(prisma);

    const state = {
      executions: 0,
      failuresRemaining: 3,
    };
    const fakeAvailability = {
      async execute(input: { menuItemId: string }): Promise<{ status: string; menuItemId: string }> {
        state.executions += 1;
        if (state.failuresRemaining > 0) {
          state.failuresRemaining -= 1;
          throw new Error('fallo transitorio de prueba');
        }
        return { status: 'applied', menuItemId: input.menuItemId };
      },
    };

    const app = await createTestApp({
      configure: (builder) => builder.overrideProvider(AVAILABILITY_INBOUND).useValue(fakeAvailability),
    });

    try {
      await waitForTopology(connection);
      await purgeAvailabilityQueues(channel);
      await publishAvailability(channel, {
        menuItemId: randomUUID(),
        available: false,
        occurredAt: new Date().toISOString(),
      });

      await waitFor(
        async () => state.executions,
        (executions) => executions >= 4,
        { description: 'tres reintentos y ejecución exitosa', timeoutMs: 15_000 },
      );
      assert.equal(await queueDepth(channel, AVAILABILITY_DLQ), 0);

      // Ahora falla siempre: debe agotar los reintentos y caer en la DLQ.
      await purgeAvailabilityQueues(channel);
      state.failuresRemaining = Number.MAX_SAFE_INTEGER;
      const executionsBefore = state.executions;

      await publishAvailability(channel, {
        menuItemId: randomUUID(),
        available: true,
        occurredAt: new Date().toISOString(),
      });

      await waitFor(
        () => queueDepth(channel, AVAILABILITY_DLQ),
        (depth) => depth >= 1,
        { description: 'mensaje agotado en la DLQ', timeoutMs: 15_000 },
      );
      assert.ok(state.executions >= executionsBefore + 4);
    } finally {
      await app.close();
    }
  });
});
