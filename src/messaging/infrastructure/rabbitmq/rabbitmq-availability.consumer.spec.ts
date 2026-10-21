import type { Channel, ConsumeMessage } from 'amqplib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEnv } from '../../../config/env.schema';
import type { ApplyAvailabilityChangeUseCase } from '../../../catalog/application/use-cases/apply-availability-change.use-case';
import { ContractValidator, type AvailabilityChangedEvent } from '../../../events/contract-validator';
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
  const consumer = new RabbitMqAvailabilityConsumer(
    { CONSUMER_MAX_RETRIES: 3 } as AppEnv,
    rabbit,
    useCase,
    new ContractValidator(),
  );
  const channel = { ack: jest.fn(), nack: jest.fn() } as unknown as Channel;

  return {
    consumer,
    channel,
    execute,
    publish: rabbit.publish as jest.Mock,
  };
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
    const { consumer, channel, execute } = build(
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
  });

  it('manda a la DLQ un mensaje que no cumple el contrato', async () => {
    const { consumer, channel, execute } = build(jest.fn());

    await handle(consumer, channel, { ...example, type: 'OtroEvento' });

    expect(execute).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('reprograma un error transitorio en la primera cola de reintento', async () => {
    const { consumer, channel, execute, publish } = build(
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
  });

  it('manda a la DLQ cuando se agotan los reintentos', async () => {
    const { consumer, channel, execute, publish } = build(
      jest.fn().mockRejectedValue(new Error('base caída')),
    );

    await handle(consumer, channel, example, { 'x-retry-count': 3 });

    expect(execute).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
