import type { PrismaClient } from '@prisma/client';
import { MENU_ITEM_SEED } from './menu-item-seed';
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
  itemsCreated: number;
  itemsExisting: number;
}

/**
 * Semilla idempotente. No sobrescribe cambios hechos por administración:
 * los alérgenos se actualizan por catálogo, las categorías y los platillos
 * solo se crean cuando no existen.
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
  const categoryIds = new Map<string, string>();

  for (const category of CATEGORY_SEED) {
    const existing = await prisma.category.findFirst({
      where: {
        OR: [{ slug: category.slug }, { name: { equals: category.name, mode: 'insensitive' } }],
      },
      select: { id: true },
    });

    if (existing) {
      categoryIds.set(category.slug, existing.id);
      categoriesExisting += 1;
      continue;
    }

    const id = uuidV5(`category:${category.slug}`);
    await prisma.category.create({
      data: {
        id,
        name: category.name,
        slug: category.slug,
        displayOrder: category.displayOrder,
        active: true,
      },
    });
    categoryIds.set(category.slug, id);
    categoriesCreated += 1;
  }

  let itemsCreated = 0;
  let itemsExisting = 0;

  for (const seed of MENU_ITEM_SEED) {
    const categoryId = categoryIds.get(seed.categorySlug);
    if (!categoryId) {
      throw new Error(`Semilla inválida: falta la categoría ${seed.categorySlug}`);
    }

    const id = uuidV5(`menu-item:${seed.slug}`);
    const existingById = await prisma.menuItem.findUnique({ where: { id }, select: { id: true } });
    if (existingById) {
      itemsExisting += 1;
      continue;
    }

    const existingByName = await prisma.menuItem.findFirst({
      where: {
        categoryId,
        name: { equals: seed.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existingByName) {
      itemsExisting += 1;
      continue;
    }

    await prisma.menuItem.create({
      data: {
        id,
        categoryId,
        name: seed.name,
        japaneseName: seed.japaneseName ?? null,
        description: seed.description,
        priceCents: seed.priceCents,
        currency: 'MXN',
        displayOrder: seed.displayOrder,
        active: true,
        allergensReviewed: true,
        available: true,
        revision: 1,
        updatedBy: null,
        allergens: {
          create: seed.allergens.map((allergenCode) => ({ allergenCode })),
        },
      },
    });
    itemsCreated += 1;
  }

  return {
    allergens: ALLERGEN_SEED.length,
    categoriesCreated,
    categoriesExisting,
    itemsCreated,
    itemsExisting,
  };
}
