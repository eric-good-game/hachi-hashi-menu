import type { ProcessedMessageRepository } from '../../application/ports/repositories';
import type { Db } from './prisma.mappers';

export class PrismaProcessedMessageRepository implements ProcessedMessageRepository {
  constructor(private readonly db: Db) {}

  async exists(messageId: string): Promise<boolean> {
    const row = await this.db.processedMessage.findUnique({
      where: { messageId },
      select: { messageId: true },
    });
    return row !== null;
  }

  async markProcessed(messageId: string, consumer: string, processedAt: Date): Promise<void> {
    await this.db.processedMessage.upsert({
      where: { messageId },
      update: {},
      create: { messageId, consumer, processedAt },
    });
  }
}
