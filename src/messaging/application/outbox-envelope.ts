import type { EventEnvelope } from '../../events/contract-validator';
import type { OutboxRecord } from '../../catalog/application/ports/repositories';

export function toOutboxEnvelope(row: OutboxRecord): EventEnvelope<Record<string, unknown>> {
  return {
    messageId: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString(),
    source: 'menu',
    correlationId: row.correlationId,
    causationId: row.causationId,
    payload: row.payload,
  };
}
