import { Prisma } from '@prisma/client';
import type { MenuItem } from '../../domain/menu-item';
import { ConflictError } from '../../domain/errors';
import type {
  AdminMenuItemView,
  MenuItemRepository,
  PublicMenuCategoryView,
} from '../../application/ports/repositories';
import { toCategory, toMenuItem, type Db, type MenuItemWithCategoryRow } from './prisma.mappers';

export class PrismaMenuItemRepository implements MenuItemRepository {
  constructor(private readonly db: Db) {}

  async create(item: MenuItem): Promise<void> {
    try {
      await this.db.menuItem.create({
        data: {
          id: item.id,
          categoryId: item.categoryId,
          name: item.name,
          japaneseName: item.japaneseName,
          description: item.description,
          priceCents: item.priceCents,
          currency: item.currency,
          photoPath: item.photoPath,
          displayOrder: item.displayOrder,
          active: item.active,
          allergensReviewed: item.allergensReviewed,
          available: item.available,
          availableUpdatedAt: item.availableUpdatedAt,
          revision: item.revision,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          updatedBy: item.updatedBy,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Ya existe un platillo con ese nombre en la categoría');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<MenuItem | null> {
    const row = await this.db.menuItem.findUnique({
      where: { id },
      include: { allergens: true },
    });
    return row ? toMenuItem(row) : null;
  }

  async existsByNameInCategory(categoryId: string, name: string, excludeId?: string): Promise<boolean> {
    const row = await this.db.menuItem.findFirst({
      where: {
        categoryId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  async update(item: MenuItem): Promise<void> {
    await this.db.menuItem.update({
      where: { id: item.id },
      data: {
        active: item.active,
        revision: item.revision,
        updatedBy: item.updatedBy,
        updatedAt: item.updatedAt,
      },
    });
  }

  async replaceAllergens(
    itemId: string,
    codes: readonly string[],
    actorId: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.menuItemAllergen.deleteMany({ where: { menuItemId: itemId } });
    if (codes.length > 0) {
      await this.db.menuItemAllergen.createMany({
        data: codes.map((allergenCode) => ({ menuItemId: itemId, allergenCode })),
        skipDuplicates: true,
      });
    }
    await this.db.menuItem.update({
      where: { id: itemId },
      data: { allergensReviewed: true, updatedBy: actorId, updatedAt: now },
    });
  }

  async listAdmin(page: number, size: number): Promise<{ items: AdminMenuItemView[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db.menuItem.findMany({
        include: { allergens: true, category: true },
        orderBy: [{ category: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * size,
        take: size,
      }),
      this.db.menuItem.count(),
    ]);

    return {
      items: rows.map((row: MenuItemWithCategoryRow) => ({
        item: toMenuItem(row),
        categoryName: row.category.name,
      })),
      total,
    };
  }

  async listPublicMenu(): Promise<PublicMenuCategoryView[]> {
    const rows = await this.db.category.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: {
        items: {
          where: { active: true },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          include: { allergens: true },
        },
      },
    });

    return rows.map((row) => ({
      category: toCategory(row),
      items: row.items.map(toMenuItem),
    }));
  }
}
