import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import {
  AVAILABILITY_DLQ,
  AVAILABILITY_QUEUE,
  AVAILABILITY_RETRY_QUEUES,
  EVENTS_EXCHANGE,
} from '../../../src/messaging/infrastructure/rabbitmq/rabbitmq.constants';

export interface RabbitClient {
  connection: ChannelModel;
  channel: ConfirmChannel;
}

export interface ConsumedEvent {
  body: unknown;
  routingKey: string;
}

export async function connectRabbit(url: string): Promise<RabbitClient> {
  const connection = await connect(url);
  const channel = await connection.createConfirmChannel();
  // Evita que un cierre de canal (p. ej. una cola inexistente) tumbe el proceso
  // de pruebas con un 'error' sin manejador.
  connection.on('error', () => undefined);
  channel.on('error', () => undefined);
  return { connection, channel };
}

export async function publishEnvelope(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  envelope: unknown,
  headers: Record<string, unknown> = {},
): Promise<void> {
  channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope), 'utf8'), {
    persistent: true,
    contentType: 'application/json',
    headers,
  });
  await channel.waitForConfirms();
}

export async function bindQueue(
  channel: ConfirmChannel,
  exchange: string,
  routingKey: string,
  queue: string,
): Promise<void> {
  await channel.assertExchange(exchange, 'topic', { durable: true });
  await channel.assertQueue(queue, { durable: false, autoDelete: true });
  await channel.bindQueue(queue, exchange, routingKey);
}

export async function deleteQueue(channel: ConfirmChannel, queue: string): Promise<void> {
  await channel.deleteQueue(queue).catch(() => undefined);
}

export async function purgeQueue(channel: ConfirmChannel, queue: string): Promise<void> {
  await channel.purgeQueue(queue).catch(() => undefined);
}

export async function purgeAvailabilityQueues(channel: ConfirmChannel): Promise<void> {
  await purgeQueue(channel, AVAILABILITY_QUEUE);
  await purgeQueue(channel, AVAILABILITY_DLQ);
  for (const retry of AVAILABILITY_RETRY_QUEUES) {
    await purgeQueue(channel, retry.queue);
  }
}

async function waitForQueue(connection: ChannelModel, queue: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const probe = await connection.createChannel().catch(() => null);
    if (probe) {
      probe.on('error', () => undefined);
      try {
        await probe.checkQueue(queue);
        await probe.close().catch(() => undefined);
        return;
      } catch {
        await probe.close().catch(() => undefined);
      }
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`La cola ${queue} no quedó declarada a tiempo`);
}

/**
 * El consumidor declara la topología de forma asíncrona tras `app.init()`.
 * Esperamos a la última cola de reintento para asegurar que toda la topología existe.
 */
export async function waitForTopology(connection: ChannelModel, timeoutMs = 15_000): Promise<void> {
  const last = AVAILABILITY_RETRY_QUEUES[AVAILABILITY_RETRY_QUEUES.length - 1]!;
  await waitForQueue(connection, last.queue, timeoutMs);
}

export async function queueDepth(channel: ConfirmChannel, queue: string): Promise<number> {
  const reply = await channel.checkQueue(queue);
  return reply.messageCount;
}

export async function consumeOne(
  channel: ConfirmChannel,
  queue: string,
  timeoutMs = 10_000,
): Promise<ConsumedEvent> {
  return new Promise<ConsumedEvent>((resolve, reject) => {
    let consumerTag: string | null = null;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      finish(() => {
        if (consumerTag) {
          void channel.cancel(consumerTag).catch(() => undefined);
        }
        reject(new Error(`Tiempo agotado esperando un mensaje en ${queue}`));
      });
    }, timeoutMs);

    channel
      .consume(
        queue,
        (message: ConsumeMessage | null) => {
          if (!message) {
            return;
          }
          finish(() => {
            channel.ack(message);
            if (consumerTag) {
              void channel.cancel(consumerTag).catch(() => undefined);
            }
            resolve({
              body: JSON.parse(message.content.toString('utf8')) as unknown,
              routingKey: message.fields.routingKey,
            });
          });
        },
        { noAck: false },
      )
      .then(({ consumerTag: tag }) => {
        consumerTag = tag;
      })
      .catch((error: unknown) => {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      });
  });
}
