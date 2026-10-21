import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed-data';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await seedDatabase(prisma);
    console.log(
      `Semilla aplicada: ${result.allergens} alérgenos, ` +
        `${result.categoriesCreated} categorías nuevas, ${result.categoriesExisting} ya existentes, ` +
        `${result.itemsCreated} platillos nuevos, ${result.itemsExisting} ya existentes`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
