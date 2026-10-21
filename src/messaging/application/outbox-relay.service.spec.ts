import type { AppEnv } from '../../config/env.schema';
import type { EventBusPort } from '../../catalog/application/ports/event-bus';
import type {
  OutboxRecord,
  OutboxRepository,
} from '../../catalog/application/ports/repositories';
import type { ClockPort } from '../../catalog/application/ports/system';
import type { EventEnvelope } from '../../events/contract-validator';
import { ContractValidator } from '../../events/contract-validator';
import { MetricsService } from '../../observability/metrics.service';
import type { RelayLockPort } from './ports/relay-lock';
import { OutboxRelay } from './outbox-relay.service';

const NOW = new Date('2026-10-20T18:42:10.000Z');

function outboxRow(seq: number, overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    seq: BigInt(seq),
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    type: 'MenuItemUpdated',
    routingKey: 'menu.menu-item-updated',
    aggregateId: '3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10',
    correlationId: '0b6f2a9e-41c5-4c0e-8f3a-2d7e9b1a5c33',
    causationId: null,
    version: 1,
    payload: {
      menuItemId: '3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10',
      revision: 1,
      name: 'Nigiri de salmón',
      priceCents: 18900,
      currency: 'MXN',
      categoryId: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
      categoryName: 'Nigiri',
      active: false,
    },
    occurredAt: NOW,
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

interface BuildOptions {
  lockEnabled?: boolean;
  acquire?: jest.Mock<Promise<boolean>, [string, string, number]>;
}

function buildRelay(rows: OutboxRecord[], publish: jest.Mock, options: BuildOptions = {}) {
  const outbox = {
    append: jest.fn(),
    listUnpublished: jest.fn().mockResolvedValue(rows),
    countUnpublished: jest.fn().mockResolvedValue(rows.length),
    markPublished: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  } satisfies OutboxRepository;
  const bus: EventBusPort = { publish };
  const clock: ClockPort = { now: () => NOW };
  const lock: RelayLockPort = {
    acquire: options.acquire ?? jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const env = {
    OUTBOX_PUBLISH_ENABLED: true,
    OUTBOX_BATCH_SIZE: 50,
    OUTBOX_POLL_INTERVAL_MS: 1000,
    OUTBOX_RELAY_LOCK_ENABLED: options.lockEnabled ?? true,
    OUTBOX_RELAY_LEASE_MS: 15_000,
  } as AppEnv;
  const metrics = new MetricsService();
  const relay = new OutboxRelay(outbox, bus, clock, env, new ContractValidator(), lock, metrics);

  return { relay, outbox, lock, metrics };
}

/** Comprueba una serie de una métrica sin depender del orden de las etiquetas. */
async function expectMetric(
  metrics: MetricsService,
  name: string,
  value: number,
  labels: Record<string, string> = {},
): Promise<void> {
  const text = await metrics.render();
  const labelPattern = Object.entries(labels)
    .map(([key, labelValue]) => `(?=[^}]*${key}="${labelValue}"[^}]*)`)
    .join('');
  const pattern = new RegExp(`^${name}\\{[^}]*\\} ${value}$`, 'm');
  const series = new RegExp(`^${name}\\{${labelPattern}[^}]*\\} ${value}$`, 'm');
  expect(text).toMatch(Object.keys(labels).length > 0 ? series : pattern);
}

describe('OutboxRelay', () => {
  it('publica en orden de seq y marca cada evento como publicado', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const { relay, outbox, metrics } = buildRelay([outboxRow(1), outboxRow(2)], publish);

    await expect(relay.pollOnce()).resolves.toBe(2);

    expect(publish.mock.calls.map(([routingKey]) => routingKey)).toEqual([
      'menu.menu-item-updated',
      'menu.menu-item-updated',
    ]);
    expect(publish.mock.calls.map(([, envelope]) => envelope.messageId)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(outbox.markPublished).toHaveBeenNthCalledWith(1, 1n, NOW);
    expect(outbox.markPublished).toHaveBeenNthCalledWith(2, 2n, NOW);
    expect(outbox.recordFailure).not.toHaveBeenCalled();
    await expectMetric(metrics, 'menu_outbox_relay_published_total', 2);
    await expectMetric(metrics, 'menu_outbox_relay_lease_held', 1);
    await expectMetric(metrics, 'menu_outbox_relay_lease_acquisitions_total', 1);
  });

  it('propaga un traceparent nuevo junto a cada evento publicado', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const { relay } = buildRelay([outboxRow(1), outboxRow(2)], publish);

    await relay.pollOnce();

    const headers = publish.mock.calls.map(
      ([, , extra]) => (extra ?? {}) as Record<string, unknown>,
    );
    const traces = new Set(headers.map((header) => header['traceparent']));
    expect(traces.size).toBe(2);
    for (const traceparent of traces) {
      expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
  });

  it('expone los fallos de publicación y de ciclo como contadores', async () => {
    const publish = jest
      .fn<Promise<void>, [string, EventEnvelope<object>]>()
      .mockRejectedValue(new Error('broker caído'));
    const { relay, metrics } = buildRelay([outboxRow(1)], publish);

    await relay.pollOnce();

    await expectMetric(metrics, 'menu_outbox_relay_failures_total', 1);
    await expectMetric(metrics, 'menu_outbox_relay_published_total', 0);
  });

  it('se detiene en el primer fallo para no romper el orden', async () => {
    const publish = jest
      .fn<Promise<void>, [string, EventEnvelope<object>]>()
      .mockRejectedValueOnce(new Error('broker caído'))
      .mockResolvedValue(undefined);
    const { relay, outbox } = buildRelay([outboxRow(1), outboxRow(2)], publish);

    await expect(relay.pollOnce()).resolves.toBe(0);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(outbox.recordFailure).toHaveBeenCalledWith(1n, 'broker caído');
    expect(outbox.markPublished).not.toHaveBeenCalled();
  });

  it('no publica un evento que no cumple el contrato', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const { relay, outbox } = buildRelay(
      [outboxRow(1, { payload: { menuItemId: 'no-es-uuid' } })],
      publish,
    );

    await expect(relay.pollOnce()).resolves.toBe(0);

    expect(publish).not.toHaveBeenCalled();
    expect(outbox.recordFailure).toHaveBeenCalledWith(
      1n,
      expect.stringContaining('no cumple el contrato'),
    );
  });

  it('no publica si otra instancia posee el lease', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const acquire = jest.fn<Promise<boolean>, [string, string, number]>().mockResolvedValue(false);
    const { relay, outbox } = buildRelay([outboxRow(1)], publish, { acquire });

    await expect(relay.pollOnce()).resolves.toBe(0);

    expect(acquire).toHaveBeenCalledWith('outbox-relay', expect.any(String), 15_000);
    expect(outbox.listUnpublished).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('renueva el lease antes de cada evento y se detiene al perderlo', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const acquire = jest
      .fn<Promise<boolean>, [string, string, number]>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { relay, outbox } = buildRelay([outboxRow(1), outboxRow(2), outboxRow(3)], publish, {
      acquire,
    });

    await expect(relay.pollOnce()).resolves.toBe(2);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(outbox.markPublished).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(4);
  });

  it('publica sin consultar el lease cuando el bloqueo está deshabilitado', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const { relay, lock } = buildRelay([outboxRow(1)], publish, { lockEnabled: false });

    await expect(relay.pollOnce()).resolves.toBe(1);

    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it('libera el lease al apagarse solo si lo poseía', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const { relay, lock } = buildRelay([outboxRow(1)], publish);

    await relay.pollOnce();
    await relay.onModuleDestroy();

    expect(lock.release).toHaveBeenCalledWith('outbox-relay', expect.any(String));
  });

  it('no libera un lease que nunca adquirió', async () => {
    const publish = jest.fn<Promise<void>, [string, EventEnvelope<object>, Record<string, unknown>?]>().mockResolvedValue(undefined);
    const acquire = jest.fn<Promise<boolean>, [string, string, number]>().mockResolvedValue(false);
    const { relay, lock } = buildRelay([outboxRow(1)], publish, { acquire });

    await relay.pollOnce();
    await relay.onModuleDestroy();

    expect(lock.release).not.toHaveBeenCalled();
  });
});
