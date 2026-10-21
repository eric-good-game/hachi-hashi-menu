import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import request from 'supertest';
import type { ChannelModel, ConfirmChannel } from 'amqplib';
import {
  AVAILABILITY_DLQ,
  AVAILABILITY_QUEUE,
  AVAILABILITY_ROUTING_KEY,
  EVENTS_EXCHANGE,
} from '../../src/messaging/infrastructure/rabbitmq/rabbitmq.constants';
import { createTestApp } from './support/app';
import { runMigrations, startPostgres, startRabbitMq } from './support/containers';
import { createPrisma, resetDatabase } from './support/db';
import {
  connectRabbit,
  publishEnvelope,
  purgeAvailabilityQueues,
  queueDepth,
  waitForTopology,
} from './support/rabbit';
import { waitFor } from './support/wait';

/** Lee una serie del texto de `/metrics` sin depender del orden de etiquetas. */
function metricValue(
  text: string,
  name: string,
  labels: Record<string, string> = {},
): number | null {
  for (const line of text.split('\n')) {
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+]+)$/.exec(line);
    if (!match || match[1] !== name) {
      continue;
    }
    const rendered = match[2] ?? '';
    const matches = Object.entries(labels).every(([key, value]) =>
      rendered.includes(`${key}="${value}"`),
    );
    if (matches) {
      return Number(match[3]);
    }
  }
  return null;
}

async function scrape(app: INestApplication): Promise<string> {
  const response = await request(app.getHttpServer()).get('/metrics').expect(200);
  assert.match(response.headers['content-type'] ?? '', /^text\/plain/);
  return response.text;
}

describe('Hito 4 — observabilidad y replay de la DLQ', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let prisma: PrismaClient;
  let connection: ChannelModel;
  let channel: ConfirmChannel;

  before(async () => {
    [postgres, rabbit] = await Promise.all([startPostgres(), startRabbitMq()]);
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
    process.env.METRICS_ENABLED = 'true';
    process.env.QUEUE_METRICS_INTERVAL_MS = '500';
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

  it('expone /metrics fuera del prefijo /api con el estado del relay y del consumidor', async () => {
    await resetDatabase(prisma);
    const app = await createTestApp();

    try {
      const text = await waitFor(
        async () => scrape(app),
        (body) => metricValue(body, 'menu_outbox_relay_lease_held') === 1,
        { description: 'el relay adquiere el lease' },
      );

      for (const name of [
        'menu_outbox_pending_events',
        'menu_outbox_relay_published_total',
        'menu_outbox_relay_failures_total',
        'menu_outbox_relay_lease_held',
        'menu_availability_consumer_processed_total',
        'menu_availability_consumer_failures_total',
        'menu_availability_consumer_retries_total',
        'menu_availability_consumer_dead_letters_total',
        'menu_availability_consumer_duration_seconds',
        'menu_availability_queue_messages',
      ]) {
        // Las métricas con etiquetas solo emiten series cuando tienen datos,
        // pero el tipo declarado siempre está presente.
        assert.match(text, new RegExp(`^# TYPE ${name} `, 'm'), `falta la métrica ${name}`);
      }

      assert.equal(metricValue(text, 'menu_outbox_pending_events'), 0);
      assert.ok(metricValue(text, 'menu_outbox_relay_lease_acquisitions_total') !== null);

      // El gauge de profundidad de colas se actualiza de forma pasiva.
      await waitFor(
        async () => scrape(app),
        (body) => metricValue(body, 'menu_availability_queue_messages', { queue: AVAILABILITY_DLQ }) === 0,
        { description: 'el gauge de la DLQ se publica' },
      );

      await request(app.getHttpServer()).get('/api/metrics').expect(404);
    } finally {
      await app.close();
    }
  });

  it('el replay de la DLQ devuelve los mensajes al intercambio original', async () => {
    await resetDatabase(prisma);
    const app = await createTestApp();
    const script = join(process.cwd(), 'scripts', 'replay-dlq.cjs');

    const runReplay = (extra: string[]): Record<string, unknown> =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [script, '--url', rabbit.getAmqpUrl(), '--limit', '5', ...extra],
          { cwd: process.cwd(), encoding: 'utf8' },
        ),
      ) as Record<string, unknown>;

    try {
      await waitForTopology(connection);
      await purgeAvailabilityQueues(channel);

      // Un contrato inválido llega a la DLQ y allí se queda cuando paramos la app.
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
        { description: 'el mensaje inválido llega a la DLQ' },
      );
    } finally {
      await app.close();
    }

    const dryRun = runReplay(['--dry-run']);
    assert.equal(dryRun.mode, 'dry-run');
    assert.equal(dryRun.replayed, 1);
    await waitFor(
      () => queueDepth(channel, AVAILABILITY_DLQ),
      (depth) => depth === 1,
      { description: 'el dry-run no consume la DLQ' },
    );
    assert.equal(await queueDepth(channel, AVAILABILITY_QUEUE), 0);

    const replayed = runReplay([]);
    assert.equal(replayed.mode, 'replay');
    assert.equal(replayed.replayed, 1);
    assert.equal(await queueDepth(channel, AVAILABILITY_DLQ), 0);
    await waitFor(
      () => queueDepth(channel, AVAILABILITY_QUEUE),
      (depth) => depth >= 1,
      { description: 'el mensaje reprogramado vuelve a la cola de disponibilidad' },
    );

    await purgeAvailabilityQueues(channel);
  });
});
