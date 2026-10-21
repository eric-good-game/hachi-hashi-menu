import type { EventEnvelope } from '../../../events/contract-validator';

export interface EventBusPort {
  publish(routingKey: string, envelope: EventEnvelope<object>): Promise<void>;
}
