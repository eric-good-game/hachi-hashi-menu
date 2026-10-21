import { Prisma } from '@prisma/client';
import { Category } from '../../domain/category';
import { MenuItem } from '../../domain/menu-item';

export type Db = Prisma.TransactionClient;

export type MenuItemRow = Prisma.MenuItemGetPayload<{ include: { allergens: true } }>;
export type MenuItemWithCategoryRow = Prisma.MenuItemGetPayload<{ include: { allergens: true; category: true } }>;
export type CategoryWithItemsRow = Prisma.CategoryGetPayload<{
  include: { items: { include: { allergens: true } } };
}>;

export function toCategory(row: {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Category {
  return Category.rehydrate({
    id: row.id,
    name: row.name,
    slug: row.slug,
    displayOrder: row.displayOrder,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toMenuItem(row: MenuItemRow): MenuItem {
  return MenuItem.rehydrate({
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    japaneseName: row.japaneseName,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    photoPath: row.photoPath,
    displayOrder: row.displayOrder,
    active: row.active,
    allergensReviewed: row.allergensReviewed,
    available: row.available,
    availableUpdatedAt: row.availableUpdatedAt,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    allergens: row.allergens.map((entry) => entry.allergenCode).sort(),
  });
}
