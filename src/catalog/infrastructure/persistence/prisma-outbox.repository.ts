import { Prisma } from '@prisma/client';
import type { NewOutboxEvent, OutboxRecord, OutboxRepository } from '../../application/ports/repositories';
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

  async listUnpublished(limit: number): Promise<OutboxRecord[]> {
    const rows = await this.db.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { seq: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({
      seq: row.seq,
      id: row.id,
      type: row.type,
      routingKey: row.routingKey,
      aggregateId: row.aggregateId,
      correlationId: row.correlationId,
      causationId: row.causationId,
      version: row.version,
      payload: row.payload as Record<string, unknown>,
      occurredAt: row.occurredAt,
      attempts: row.attempts,
      lastError: row.lastError,
    }));
  }

  async countUnpublished(): Promise<number> {
    return this.db.outboxEvent.count({ where: { publishedAt: null } });
  }

  async markPublished(seq: bigint, publishedAt: Date): Promise<void> {
    await this.db.outboxEvent.update({
      where: { seq },
      data: { publishedAt, lastError: null },
    });
  }

  async recordFailure(seq: bigint, error: string): Promise<void> {
    await this.db.outboxEvent.update({
      where: { seq },
      data: { attempts: { increment: 1 }, lastError: error.slice(0, 2000) },
    });
  }
}
