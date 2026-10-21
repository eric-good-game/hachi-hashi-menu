import type { EventEnvelope } from '../../../events/contract-validator';

export interface EventBusPort {
  /**
   * Publica un evento. `headers` permite propagar contexto de traza
   * (`traceparent`) sin tocar el sobre del contrato.
   */
  publish(
    routingKey: string,
    envelope: EventEnvelope<object>,
    headers?: Record<string, unknown>,
  ): Promise<void>;
}
