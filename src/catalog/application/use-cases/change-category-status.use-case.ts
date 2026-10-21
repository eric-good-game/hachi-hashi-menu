import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, UNIT_OF_WORK } from '../../catalog.tokens';
import type { Category } from '../../domain/category';
import { ConflictError, NotFoundError } from '../../domain/errors';
import type { UnitOfWork } from '../ports/repositories';
import type { ClockPort } from '../ports/system';

export interface ChangeCategoryStatusInput {
  categoryId: string;
  active: boolean;
}

@Injectable()
export class ChangeCategoryStatusUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: ChangeCategoryStatusInput): Promise<Category> {
    return this.uow.run(async (repositories) => {
      const category = await repositories.categories.findById(input.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría no existe');
      }

      if (category.active === input.active) {
        return category;
      }

      if (!input.active) {
        const activeItems = await repositories.items.countActiveByCategory(category.id);
        if (activeItems > 0) {
          throw new ConflictError(
            'No se puede desactivar una categoría con platillos activos (RN-06)',
            'RN-06',
          );
        }
      }

      const updated = category.withStatus(input.active, this.clock.now());
      await repositories.categories.update(updated);
      return updated;
    });
  }
}
