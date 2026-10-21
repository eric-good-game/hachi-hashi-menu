import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, ID_GENERATOR, UNIT_OF_WORK } from '../../catalog.tokens';
import {
  Category,
  categorySlugFromName,
  normalizeCategoryName,
  normalizeCategorySlug,
} from '../../domain/category';
import { ConflictError } from '../../domain/errors';
import type { UnitOfWork } from '../ports/repositories';
import type { ClockPort, IdGeneratorPort } from '../ports/system';

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  displayOrder: number;
}

@Injectable()
export class CreateCategoryUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async execute(input: CreateCategoryInput): Promise<Category> {
    const name = normalizeCategoryName(input.name);
    const id = this.ids.uuid();
    const slug = input.slug ? normalizeCategorySlug(input.slug) : categorySlugFromName(name, id);

    return this.uow.run(async (repositories) => {
      const duplicate = await repositories.categories.findByNameInsensitive(name);
      if (duplicate) {
        throw new ConflictError(`Ya existe una categoría llamada "${name}"`);
      }

      const category = Category.create({
        id,
        name,
        slug,
        displayOrder: input.displayOrder,
        now: this.clock.now(),
      });

      await repositories.categories.create(category);
      return category;
    });
  }
}
