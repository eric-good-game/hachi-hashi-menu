import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { AppEnv } from '../../config/env.schema';
import { MetricsService } from '../../observability/metrics.service';
import { AVAILABILITY_DLQ, AVAILABILITY_QUEUE } from './rabbitmq/rabbitmq.constants';
import { RabbitMqService } from './rabbitmq/rabbitmq.service';

const WATCHED_QUEUES = [AVAILABILITY_QUEUE, AVAILABILITY_DLQ] as const;

/**
 * Publica la profundidad de las colas de disponibilidad como gauge (D-49).
 *
 * Se consulta de forma pasiva cada `QUEUE_METRICS_INTERVAL_MS`: no consume ni
 * altera mensajes. Si el broker no responde, se registra en debug y los gauges
 * conservan su último valor.
 */
@Injectable()
export class AvailabilityQueueMetrics implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityQueueMetrics.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    @Inject('APP_ENV') private readonly env: AppEnv,
    private readonly rabbit: RabbitMqService,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.CONSUMERS_ENABLED || !this.env.METRICS_ENABLED) {
      return;
    }

    this.timer = setInterval(() => {
      void this.collect();
    }, this.env.QUEUE_METRICS_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async collect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    let channel: Awaited<ReturnType<RabbitMqService['createConsumerChannel']>> | null = null;

    try {
      channel = await this.rabbit.createConsumerChannel();
      for (const queue of WATCHED_QUEUES) {
        const { messageCount } = await channel.checkQueue(queue);
        this.metrics.availabilityQueueMessages.set({ queue }, messageCount);
      }
    } catch (error) {
      this.logger.debug(
        'No se pudo leer la profundidad de las colas de disponibilidad',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      await channel?.close().catch(() => undefined);
    }
  }
}
