import { Injectable, Logger } from '@nestjs/common';
import type { EventBusPort } from '../../catalog/application/ports/event-bus';
import type { EventEnvelope } from '../../events/contract-validator';
import { logContext } from '../../observability/log-context';

@Injectable()
export class LoggingEventBus implements EventBusPort {
  private readonly logger = new Logger(LoggingEventBus.name);

  async publish(
    routingKey: string,
    envelope: EventEnvelope<object>,
    headers?: Record<string, unknown>,
  ): Promise<void> {
    const context = logContext({ correlationId: envelope.correlationId, traceparent: headers?.['traceparent'] });
    this.logger.log(`Evento no publicado (bus de logs): ${routingKey}${context}`);
  }
}
