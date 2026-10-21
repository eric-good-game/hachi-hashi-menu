import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type Options,
} from 'amqplib';
import type { EventEnvelope } from '../../../events/contract-validator';
import type { AppEnv } from '../../../config/env.schema';
import {
  AVAILABILITY_DLQ,
  AVAILABILITY_DLQ_ROUTING_KEY,
  AVAILABILITY_QUEUE,
  AVAILABILITY_RETRY_QUEUES,
  AVAILABILITY_ROUTING_KEY,
  DEAD_LETTER_EXCHANGE,
  EVENTS_EXCHANGE,
  RETRY_EXCHANGE,
} from './rabbitmq.constants';

@Injectable()
export class RabbitMqService implements OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: ChannelModel | null = null;
  private publisher: ConfirmChannel | null = null;
  private connecting: Promise<ChannelModel> | null = null;

  constructor(@Inject('APP_ENV') private readonly env: AppEnv) {}

  async publish(
    exchange: string,
    routingKey: string,
    envelope: EventEnvelope<object>,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const channel = await this.getPublisher();
    const options: Options.Publish = {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: envelope.messageId,
      type: envelope.type,
      correlationId: envelope.correlationId,
      timestamp: Math.floor(Date.now() / 1000),
      appId: 'menu',
      headers,
    };

    try {
      channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(envelope), 'utf8'), options);
      await channel.waitForConfirms();
    } catch (error) {
      this.logger.error(
        `No se pudo confirmar la publicación en ${exchange}/${routingKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      this.publisher = null;
      try {
        await channel.close();
      } catch {
        // El canal ya está cerrado.
      }
      throw error;
    }
  }

  async createConsumerChannel(): Promise<Channel> {
    const connection = await this.getConnection();
    const channel = await connection.createChannel();
    await this.assertTopology(channel);
    channel.on('error', (error) => {
      this.logger.error('Error en el canal consumidor', error.stack);
    });
    return channel;
  }

  private async getPublisher(): Promise<ConfirmChannel> {
    if (this.publisher) {
      return this.publisher;
    }

    const connection = await this.getConnection();
    const channel = await connection.createConfirmChannel();
    await this.assertTopology(channel);
    channel.on('error', (error) => {
      this.logger.error('Error en el canal publicador', error.stack);
    });
    channel.on('close', () => {
      if (this.publisher === channel) {
        this.publisher = null;
      }
    });

    this.publisher = channel;
    return channel;
  }

  private async getConnection(): Promise<ChannelModel> {
    if (this.connection) {
      return this.connection;
    }
    if (this.connecting) {
      return this.connecting;
    }

    const url = this.env.RABBITMQ_URL;
    if (!url) {
      throw new Error('RABBITMQ_URL no está configurada');
    }

    this.connecting = connect(url)
      .then((connection) => {
        this.connection = connection;
        connection.on('error', (error) => {
          this.logger.error('Error de conexión con RabbitMQ', error.stack);
        });
        connection.on('close', () => {
          this.logger.warn('Conexión con RabbitMQ cerrada');
          this.connection = null;
          this.publisher = null;
        });
        this.logger.log('Conexión con RabbitMQ establecida');
        return connection;
      })
      .finally(() => {
        this.connecting = null;
      });

    return this.connecting;
  }

  private async assertTopology(channel: Channel): Promise<void> {
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });

    await channel.assertQueue(AVAILABILITY_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': AVAILABILITY_DLQ_ROUTING_KEY,
      },
    });
    await channel.bindQueue(AVAILABILITY_QUEUE, EVENTS_EXCHANGE, AVAILABILITY_ROUTING_KEY);

    await channel.assertQueue(AVAILABILITY_DLQ, { durable: true });
    await channel.bindQueue(AVAILABILITY_DLQ, DEAD_LETTER_EXCHANGE, AVAILABILITY_DLQ_ROUTING_KEY);

    for (const [index, retry] of AVAILABILITY_RETRY_QUEUES.entries()) {
      await channel.assertQueue(retry.queue, {
        durable: true,
        arguments: {
          'x-message-ttl': this.env.RABBITMQ_RETRY_TTLS_MS[index]!,
          'x-dead-letter-exchange': EVENTS_EXCHANGE,
          'x-dead-letter-routing-key': AVAILABILITY_ROUTING_KEY,
        },
      });
      await channel.bindQueue(retry.queue, RETRY_EXCHANGE, retry.routingKey);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const publisher = this.publisher;
    const connection = this.connection;
    this.publisher = null;
    this.connection = null;

    if (publisher) {
      await publisher.close().catch(() => undefined);
    }
    if (connection) {
      await connection.close().catch(() => undefined);
    }
  }
}
