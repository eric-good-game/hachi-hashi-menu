import { Prisma } from '@prisma/client';
import type { Category } from '../../domain/category';
import { ConflictError } from '../../domain/errors';
import type { CategoryRepository } from '../../application/ports/repositories';
import { toCategory, type Db } from './prisma.mappers';

export class PrismaCategoryRepository implements CategoryRepository {
  constructor(private readonly db: Db) {}

  async create(category: Category): Promise<void> {
    try {
      await this.db.category.create({
        data: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          displayOrder: category.displayOrder,
          active: category.active,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Ya existe una categoría con el mismo nombre o slug');
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Category | null> {
    const row = await this.db.category.findUnique({ where: { id } });
    return row ? toCategory(row) : null;
  }

  async update(category: Category): Promise<void> {
    await this.db.category.update({
      where: { id: category.id },
      data: {
        name: category.name,
        displayOrder: category.displayOrder,
        active: category.active,
        updatedAt: category.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    try {
      await this.db.category.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError('No se puede borrar una categoría con platillos');
      }
      throw error;
    }
  }

  async findByNameInsensitive(name: string): Promise<Category | null> {
    const row = await this.db.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    return row ? toCategory(row) : null;
  }

  async listActive(): Promise<Category[]> {
    const rows = await this.db.category.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toCategory);
  }

  async listAll(): Promise<Category[]> {
    const rows = await this.db.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toCategory);
  }
}
