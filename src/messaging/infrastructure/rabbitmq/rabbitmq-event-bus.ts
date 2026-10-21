import { Injectable } from '@nestjs/common';
import type { EventBusPort } from '../../../catalog/application/ports/event-bus';
import type { EventEnvelope } from '../../../events/contract-validator';
import { EVENTS_EXCHANGE } from './rabbitmq.constants';
import { RabbitMqService } from './rabbitmq.service';

@Injectable()
export class RabbitMqEventBus implements EventBusPort {
  constructor(private readonly rabbit: RabbitMqService) {}

  async publish(routingKey: string, envelope: EventEnvelope<object>): Promise<void> {
    await this.rabbit.publish(EVENTS_EXCHANGE, routingKey, envelope);
  }
}
