import type { PrismaClient } from '@prisma/client';
import { uuidV5 } from './uuid-v5';

export const ALLERGEN_SEED = [
  { code: 'gluten', name: 'Gluten' },
  { code: 'crustaceos', name: 'Crustáceos' },
  { code: 'moluscos', name: 'Moluscos' },
  { code: 'pescado', name: 'Pescado' },
  { code: 'huevo', name: 'Huevo' },
  { code: 'lacteos', name: 'Lácteos' },
  { code: 'soya', name: 'Soya' },
  { code: 'ajonjoli', name: 'Ajonjolí' },
  { code: 'cacahuate', name: 'Cacahuate' },
  { code: 'frutos-secos', name: 'Frutos secos' },
  { code: 'sulfitos', name: 'Sulfitos' },
] as const;

export const CATEGORY_SEED = [
  { name: 'Entradas', slug: 'entradas', displayOrder: 10 },
  { name: 'Nigiri', slug: 'nigiri', displayOrder: 20 },
  { name: 'Sashimi', slug: 'sashimi', displayOrder: 30 },
  { name: 'Rolls', slug: 'rolls', displayOrder: 40 },
  { name: 'Ramen', slug: 'ramen', displayOrder: 50 },
  { name: 'Postres', slug: 'postres', displayOrder: 60 },
  { name: 'Bebidas', slug: 'bebidas', displayOrder: 70 },
] as const;

export interface SeedResult {
  allergens: number;
  categoriesCreated: number;
  categoriesExisting: number;
}

/**
 * Semilla idempotente. No sobrescribe cambios hechos por administración:
 * los alérgenos se actualizan por catálogo y las categorías solo se crean
 * cuando no existen.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<SeedResult> {
  for (const allergen of ALLERGEN_SEED) {
    await prisma.allergen.upsert({
      where: { code: allergen.code },
      update: { name: allergen.name },
      create: { code: allergen.code, name: allergen.name },
    });
  }

  let categoriesCreated = 0;
  let categoriesExisting = 0;

  for (const category of CATEGORY_SEED) {
    const existing = await prisma.category.findFirst({
      where: { name: { equals: category.name, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existing) {
      categoriesExisting += 1;
      continue;
    }

    await prisma.category.create({
      data: {
        id: uuidV5(`category:${category.slug}`),
        name: category.name,
        slug: category.slug,
        displayOrder: category.displayOrder,
        active: true,
      },
    });
    categoriesCreated += 1;
  }

  return {
    allergens: ALLERGEN_SEED.length,
    categoriesCreated,
    categoriesExisting,
  };
}
