import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK } from '../../catalog.tokens';
import { ConflictError, NotFoundError } from '../../domain/errors';
import type { UnitOfWork } from '../ports/repositories';

@Injectable()
export class DeleteCategoryUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(categoryId: string): Promise<void> {
    await this.uow.run(async (repositories) => {
      const category = await repositories.categories.findById(categoryId);
      if (!category) {
        throw new NotFoundError('La categoría no existe');
      }

      const itemCount = await repositories.items.countByCategory(categoryId);
      if (itemCount > 0) {
        throw new ConflictError('No se puede borrar una categoría que tuvo platillos (RN-06)', 'RN-06');
      }

      await repositories.categories.delete(categoryId);
    });
  }
}
