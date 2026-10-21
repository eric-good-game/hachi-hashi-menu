export type AvailabilityChangeStatus = 'applied' | 'duplicate' | 'stale' | 'unknown';

export interface ApplyAvailabilityChangeInput {
  messageId: string;
  menuItemId: string;
  available: boolean;
  occurredAt: Date;
}

export interface ApplyAvailabilityChangeResult {
  status: AvailabilityChangeStatus;
  menuItemId: string;
}

/**
 * Puerto de entrada para cambios de disponibilidad. En la etapa A lo invoca el
 * simulador HTTP; en la etapa B, el consumidor de RabbitMQ.
 */
export interface AvailabilityInboundPort {
  execute(input: ApplyAvailabilityChangeInput): Promise<ApplyAvailabilityChangeResult>;
}
