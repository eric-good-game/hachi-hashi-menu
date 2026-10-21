import { Inject, Injectable } from '@nestjs/common';
import { buildMenuItemUpdatedEvent } from '../../../events/build-menu-item-updated.event';
import { CLOCK, CORRELATION_CONTEXT, ID_GENERATOR, UNIT_OF_WORK } from '../../catalog.tokens';
import { normalizeCategoryName, type Category } from '../../domain/category';
import { ConflictError, NotFoundError } from '../../domain/errors';
import type { UnitOfWork } from '../ports/repositories';
import type { ClockPort, CorrelationContextPort, IdGeneratorPort } from '../ports/system';

export interface UpdateCategoryInput {
  categoryId: string;
  name?: string;
  displayOrder?: number;
  actorId: string | null;
}

export interface UpdateCategoryResult {
  category: Category;
  itemsUpdated: number;
}

@Injectable()
export class UpdateCategoryUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(CORRELATION_CONTEXT) private readonly correlation: CorrelationContextPort,
  ) {}

  async execute(input: UpdateCategoryInput): Promise<UpdateCategoryResult> {
    return this.uow.run(async (repositories) => {
      const category = await repositories.categories.findById(input.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría no existe');
      }

      const name = input.name !== undefined ? normalizeCategoryName(input.name) : undefined;
      if (name !== undefined && name !== category.name) {
        const duplicate = await repositories.categories.findByNameInsensitive(name);
        if (duplicate && duplicate.id !== category.id) {
          throw new ConflictError(`Ya existe una categoría llamada "${name}"`);
        }
      }

      const now = this.clock.now();
      const updated = category.updateDetails({ name, displayOrder: input.displayOrder }, now);
      if (updated === category) {
        return { category, itemsUpdated: 0 };
      }

      await repositories.categories.update(updated);

      if (updated.name === category.name) {
        return { category: updated, itemsUpdated: 0 };
      }

      const items = await repositories.items.listByCategoryId(updated.id);
      const correlationId = this.correlation.correlationId();

      for (const item of items) {
        const bumped = item.bumpRevision(now, input.actorId);
        await repositories.items.update(bumped);
        await repositories.outbox.append(
          buildMenuItemUpdatedEvent({
            item: bumped,
            category: updated,
            correlationId,
            messageId: this.ids.uuid(),
            occurredAt: now,
          }),
        );
      }

      return { category: updated, itemsUpdated: items.length };
    });
  }
}
