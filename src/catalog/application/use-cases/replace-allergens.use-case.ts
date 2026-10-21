import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, UNIT_OF_WORK } from '../../catalog.tokens';
import { NotFoundError, ValidationError } from '../../domain/errors';
import type { AdminMenuItemView, UnitOfWork } from '../ports/repositories';
import type { ClockPort } from '../ports/system';

export interface ReplaceAllergensInput {
  itemId: string;
  allergenCodes: string[];
  actorId: string | null;
}

@Injectable()
export class ReplaceAllergensUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: ReplaceAllergensInput): Promise<AdminMenuItemView> {
    return this.uow.run(async (repositories) => {
      const item = await repositories.items.findById(input.itemId);
      if (!item) {
        throw new NotFoundError('El platillo no existe');
      }

      const category = await repositories.categories.findById(item.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría del platillo no existe');
      }

      const codes = [...new Set(input.allergenCodes.map((code) => code.trim()).filter(Boolean))];
      const existing = await repositories.allergens.existingCodes(codes);
      const unknown = codes.filter((code) => !existing.has(code));
      if (unknown.length > 0) {
        throw new ValidationError(`Alérgenos desconocidos: ${unknown.join(', ')}`);
      }

      const updated = item.replaceAllergens(codes, this.clock.now(), input.actorId);
      await repositories.items.replaceAllergens(updated.id, codes, input.actorId, updated.updatedAt);
      return { item: updated, categoryName: category.name };
    });
  }
}
