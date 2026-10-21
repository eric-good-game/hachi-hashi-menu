import { PrismaClient } from '@prisma/client';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "relay_lock", "outbox_event", "processed_message", "menu_item_allergen", "menu_item", "category", "allergen" RESTART IDENTITY CASCADE',
  );
}
