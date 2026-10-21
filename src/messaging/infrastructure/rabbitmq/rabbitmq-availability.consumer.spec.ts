import type { Channel, ConsumeMessage } from 'amqplib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEnv } from '../../../config/env.schema';
import type { ApplyAvailabilityChangeUseCase } from '../../../catalog/application/use-cases/apply-availability-change.use-case';
import { ContractValidator, type AvailabilityChangedEvent } from '../../../events/contract-validator';
import { MetricsService } from '../../../observability/metrics.service';
import { RETRY_EXCHANGE } from './rabbitmq.constants';
import { RabbitMqAvailabilityConsumer } from './rabbitmq-availability.consumer';
import type { RabbitMqService } from './rabbitmq.service';

const example = (
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'contracts', 'menu-item-availability-changed.v1.examples.json'),
      'utf8',
    ),
  ) as AvailabilityChangedEvent[]
)[0]!;

function message(envelope: unknown, headers: Record<string, unknown> = {}): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(envelope), 'utf8'),
    properties: { headers },
  } as unknown as ConsumeMessage;
}

function build(execute: jest.Mock) {
  const rabbit = { publish: jest.fn().mockResolvedValue(undefined) } as unknown as RabbitMqService;
  const useCase = { execute } as unknown as ApplyAvailabilityChangeUseCase;
  const metrics = new MetricsService();
  const consumer = new RabbitMqAvailabilityConsumer(
    { CONSUMER_MAX_RETRIES: 3 } as AppEnv,
    rabbit,
    useCase,
    new ContractValidator(),
    metrics,
  );
  const channel = { ack: jest.fn(), nack: jest.fn() } as unknown as Channel;

  return {
    consumer,
    channel,
    execute,
    publish: rabbit.publish as jest.Mock,
    metrics,
  };
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
  expect(text).toMatch(labels && Object.keys(labels).length > 0 ? series : pattern);
}

async function handle(
  consumer: RabbitMqAvailabilityConsumer,
  channel: Channel,
  envelope: unknown,
  headers: Record<string, unknown> = {},
): Promise<void> {
  await (
    consumer as unknown as {
      handle: (channel: Channel, message: ConsumeMessage) => Promise<void>;
    }
  ).handle(channel, message(envelope, headers));
}

describe('RabbitMqAvailabilityConsumer', () => {
  it('valida el ejemplo, aplica la disponibilidad y confirma', async () => {
    const { consumer, channel, execute, metrics } = build(
      jest.fn().mockResolvedValue({ status: 'applied', menuItemId: example.payload.menuItemId }),
    );

    await handle(consumer, channel, example);

    expect(execute).toHaveBeenCalledWith({
      messageId: example.messageId,
      menuItemId: example.payload.menuItemId,
      available: example.payload.available,
      occurredAt: new Date(example.occurredAt),
    });
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
    await expectMetric(metrics, 'menu_availability_consumer_processed_total', 1, {
      status: 'applied',
    });
    await expectMetric(metrics, 'menu_availability_consumer_duration_seconds_count', 1, {
      status: 'applied',
    });
  });

  it('manda a la DLQ un mensaje que no cumple el contrato', async () => {
    const { consumer, channel, execute, metrics } = build(jest.fn());

    await handle(consumer, channel, { ...example, type: 'OtroEvento' });

    expect(execute).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    await expectMetric(metrics, 'menu_availability_consumer_dead_letters_total', 1, {
      reason: 'invalid_contract',
    });
  });

  it('reprograma un error transitorio en la primera cola de reintento', async () => {
    const { consumer, channel, execute, publish, metrics } = build(
      jest.fn().mockRejectedValue(new Error('base caída')),
    );

    await handle(consumer, channel, example);

    expect(execute).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      'availability.retry.1',
      example,
      expect.objectContaining({ 'x-retry-count': 1 }),
    );
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
    await expectMetric(metrics, 'menu_availability_consumer_failures_total', 1);
    await expectMetric(metrics, 'menu_availability_consumer_retries_total', 1);
  });

  it('continúa la traza del mensaje al reprogramar un reintento', async () => {
    const { consumer, channel, publish } = build(
      jest.fn().mockRejectedValue(new Error('base caída')),
    );
    const traceparent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

    await handle(consumer, channel, example, { traceparent });

    expect(publish).toHaveBeenCalledWith(
      RETRY_EXCHANGE,
      'availability.retry.1',
      example,
      expect.objectContaining({
        traceparent: expect.stringMatching(
          new RegExp(`^00-${'a'.repeat(32)}-[0-9a-f]{16}-01$`),
        ),
      }),
    );
  });

  it('manda a la DLQ cuando se agotan los reintentos', async () => {
    const { consumer, channel, execute, publish, metrics } = build(
      jest.fn().mockRejectedValue(new Error('base caída')),
    );

    await handle(consumer, channel, example, { 'x-retry-count': 3 });

    expect(execute).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    await expectMetric(metrics, 'menu_availability_consumer_dead_letters_total', 1, {
      reason: 'retries_exhausted',
    });
  });
});
