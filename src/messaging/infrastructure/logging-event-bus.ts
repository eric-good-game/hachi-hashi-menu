import { Injectable, Logger } from '@nestjs/common';
import type { EventBusPort } from '../../catalog/application/ports/event-bus';
import type { EventEnvelope } from '../../events/contract-validator';

@Injectable()
export class LoggingEventBus implements EventBusPort {
  private readonly logger = new Logger(LoggingEventBus.name);

  async publish(routingKey: string, envelope: EventEnvelope<object>): Promise<void> {
    this.logger.log(`Evento no publicado (bus de logs): ${routingKey} ${JSON.stringify(envelope)}`);
  }
}
