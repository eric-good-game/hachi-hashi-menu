import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { AppEnv } from '../../../config/env.schema';
import type {
  ApplyAvailabilityChangeResult,
  AvailabilityInboundPort,
} from '../../../catalog/application/ports/availability-inbound';
import { AVAILABILITY_INBOUND } from '../../../catalog/catalog.tokens';
import { ContractValidator, type AvailabilityChangedEvent } from '../../../events/contract-validator';
import { logContext } from '../../../observability/log-context';
import { MetricsService } from '../../../observability/metrics.service';
import { continueTraceparent } from '../../../observability/trace-context';
import {
  AVAILABILITY_QUEUE,
  RETRY_EXCHANGE,
  retryQueueForAttempt,
} from './rabbitmq.constants';
import { RabbitMqService } from './rabbitmq.service';

const RECONNECT_DELAY_MS = 5_000;

@Injectable()
export class RabbitMqAvailabilityConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqAvailabilityConsumer.name);
  private channel: Channel | null = null;
  private consumerTag: string | null = null;
  private stopped = false;

  constructor(
    @Inject('APP_ENV') private readonly env: AppEnv,
    private readonly rabbit: RabbitMqService,
    @Inject(AVAILABILITY_INBOUND) private readonly applyAvailability: AvailabilityInboundPort,
    private readonly validator: ContractValidator,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CONSUMERS_ENABLED) {
      this.logger.log('Consumidor de disponibilidad deshabilitado');
      return;
    }

    this.logger.log(
      `Consumidor de disponibilidad activo en ${AVAILABILITY_QUEUE} (máx. ${this.env.CONSUMER_MAX_RETRIES} reintentos)`,
    );
    void this.consumeLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const channel = this.channel;
    const consumerTag = this.consumerTag;
    this.channel = null;
    this.consumerTag = null;

    if (channel && consumerTag) {
      await channel.cancel(consumerTag).catch(() => undefined);
    }
    if (channel) {
      await channel.close().catch(() => undefined);
    }
  }

  private async consumeLoop(): Promise<void> {
    while (!this.stopped) {
      let channel: Channel | null = null;

      try {
        const activeChannel = await this.rabbit.createConsumerChannel();
        channel = activeChannel;
        this.channel = activeChannel;
        await activeChannel.prefetch(1);
        const { consumerTag } = await activeChannel.consume(
          AVAILABILITY_QUEUE,
          (message) => {
            if (!message) {
              return;
            }
            void this.handle(activeChannel, message).catch((error: unknown) => {
              this.logger.error(
                'Error no controlado al procesar disponibilidad',
                error instanceof Error ? error.stack : String(error),
              );
            });
          },
          { noAck: false },
        );
        this.consumerTag = consumerTag;
        this.logger.log(`Esperando mensajes en ${AVAILABILITY_QUEUE}`);

        await new Promise<void>((resolveClose) => {
          activeChannel.once('close', () => resolveClose());
          activeChannel.once('error', (error) => {
            this.logger.error('Error en el canal consumidor', error.stack);
          });
        });
      } catch (error) {
        this.logger.error(
          'No se pudo iniciar el consumidor de disponibilidad',
          error instanceof Error ? error.stack : String(error),
        );
      } finally {
        if (this.channel === channel) {
          this.channel = null;
          this.consumerTag = null;
        }
        if (channel) {
          await channel.close().catch(() => undefined);
        }
      }

      if (!this.stopped) {
        await this.delay(RECONNECT_DELAY_MS);
      }
    }
  }

  private async handle(channel: Channel, message: ConsumeMessage): Promise<void> {
    const traceparent = message.properties.headers?.['traceparent'];
    let envelope: AvailabilityChangedEvent;

    try {
      const parsed: unknown = JSON.parse(message.content.toString('utf8'));
      envelope = this.validator.validateAvailabilityChanged(parsed);
    } catch (error) {
      this.metrics.availabilityDeadLetters.inc({ reason: 'invalid_contract' });
      this.logger.warn(
        `Mensaje descartado a la DLQ por contrato inválido${logContext({ traceparent })}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      channel.nack(message, false, false);
      return;
    }

    const context = logContext({ correlationId: envelope.correlationId, traceparent });
    const startedAt = process.hrtime.bigint();

    try {
      const result = await this.applyAvailability.execute({
        messageId: envelope.messageId,
        menuItemId: envelope.payload.menuItemId,
        available: envelope.payload.available,
        occurredAt: new Date(envelope.occurredAt),
      });

      channel.ack(message);
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metrics.recordAvailabilityResult(result.status, durationSeconds);
      this.logAvailabilityResult(envelope, result, context);
    } catch (error) {
      this.metrics.availabilityFailures.inc();
      this.logger.error(
        `Error transitorio aplicando disponibilidad del platillo ${envelope.payload.menuItemId}${context}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.retryOrDeadLetter(channel, message, envelope, traceparent);
    }
  }

  private async retryOrDeadLetter(
    channel: Channel,
    message: ConsumeMessage,
    envelope: AvailabilityChangedEvent,
    traceparent: unknown,
  ): Promise<void> {
    const rawRetry = message.properties.headers?.['x-retry-count'];
    const retryCount = Number(rawRetry ?? 0);
    const context = logContext({ correlationId: envelope.correlationId, traceparent });

    if (!Number.isFinite(retryCount) || retryCount >= this.env.CONSUMER_MAX_RETRIES) {
      this.metrics.availabilityDeadLetters.inc({ reason: 'retries_exhausted' });
      this.logger.error(
        `Mensaje ${envelope.messageId} agotó los reintentos; se envía a la DLQ${context}`,
      );
      channel.nack(message, false, false);
      return;
    }

    const retry = retryQueueForAttempt(retryCount);

    try {
      await this.rabbit.publish(RETRY_EXCHANGE, retry.routingKey, envelope, {
        ...(message.properties.headers ?? {}),
        traceparent: continueTraceparent(traceparent),
        'x-retry-count': retryCount + 1,
      });
      channel.ack(message);
      this.metrics.availabilityRetries.inc();
      this.logger.warn(
        `Mensaje ${envelope.messageId} reprogramado para reintento ${retryCount + 1} en ${retry.queue}${context}`,
      );
    } catch (error) {
      this.logger.error(
        `No se pudo reprogramar el mensaje ${envelope.messageId}; se devuelve a la cola${context}`,
        error instanceof Error ? error.stack : String(error),
      );
      channel.nack(message, false, true);
    }
  }

  private logAvailabilityResult(
    envelope: AvailabilityChangedEvent,
    result: ApplyAvailabilityChangeResult,
    context: string,
  ): void {
    const message =
      `Disponibilidad ${envelope.payload.available ? 'disponible' : 'agotada'} ` +
      `para ${envelope.payload.menuItemId}: ${result.status}${context}`;
    if (result.status === 'unknown') {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
