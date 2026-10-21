import { Prisma } from '@prisma/client';
import type { MenuItem } from '../../domain/menu-item';
import { ConflictError } from '../../domain/errors';
import type {
  AdminMenuItemView,
  MenuItemRepository,
  PaginatedItems,
  PublicItemsFilter,
  PublicMenuItemView,
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

  async findPublicById(id: string): Promise<PublicMenuItemView | null> {
    const row = await this.db.menuItem.findFirst({
      where: { id, active: true, category: { is: { active: true } } },
      include: { allergens: true, category: true },
    });
    return row ? { item: toMenuItem(row), categoryName: row.category.name } : null;
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

  async updateDetails(item: MenuItem): Promise<void> {
    await this.db.menuItem.update({
      where: { id: item.id },
      data: {
        categoryId: item.categoryId,
        name: item.name,
        japaneseName: item.japaneseName,
        description: item.description,
        priceCents: item.priceCents,
        displayOrder: item.displayOrder,
        revision: item.revision,
        updatedBy: item.updatedBy,
        updatedAt: item.updatedAt,
      },
    });
  }

  async updatePhoto(
    itemId: string,
    photoPath: string | null,
    actorId: string | null,
    now: Date,
  ): Promise<void> {
    await this.db.menuItem.update({
      where: { id: itemId },
      data: { photoPath, updatedBy: actorId, updatedAt: now },
    });
  }

  async listByCategoryId(categoryId: string): Promise<MenuItem[]> {
    const rows = await this.db.menuItem.findMany({
      where: { categoryId },
      include: { allergens: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toMenuItem);
  }

  async countByCategory(categoryId: string): Promise<number> {
    return this.db.menuItem.count({ where: { categoryId } });
  }

  async countActiveByCategory(categoryId: string): Promise<number> {
    return this.db.menuItem.count({ where: { categoryId, active: true } });
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

  async listPublicItems(filter: PublicItemsFilter): Promise<PaginatedItems> {
    const where: Prisma.MenuItemWhereInput = {
      active: true,
      category: { is: { active: true } },
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      ...(filter.available !== undefined ? { available: filter.available } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { description: { contains: filter.q, mode: 'insensitive' } },
              { japaneseName: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filter.excludeAllergens.length > 0
        ? { allergens: { none: { allergenCode: { in: filter.excludeAllergens } } } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.menuItem.findMany({
        where,
        include: { allergens: true, category: true },
        orderBy: [{ category: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { name: 'asc' }],
        skip: (filter.page - 1) * filter.size,
        take: filter.size,
      }),
      this.db.menuItem.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({ item: toMenuItem(row), categoryName: row.category.name })),
      total,
    };
  }
}
