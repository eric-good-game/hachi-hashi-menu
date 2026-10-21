import { Prisma } from '@prisma/client';
import type { NewOutboxEvent, OutboxRepository } from '../../application/ports/repositories';
import type { Db } from './prisma.mappers';

export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Db) {}

  async append(event: NewOutboxEvent): Promise<void> {
    await this.db.outboxEvent.create({
      data: {
        id: event.id,
        type: event.type,
        routingKey: event.routingKey,
        aggregateId: event.aggregateId,
        correlationId: event.correlationId,
        causationId: event.causationId,
        version: event.version,
        payload: event.payload as Prisma.InputJsonValue,
        occurredAt: event.occurredAt,
      },
    });
  }
}
