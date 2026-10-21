import { Inject, Injectable } from '@nestjs/common';
import { buildMenuItemUpdatedEvent } from '../../../events/build-menu-item-updated.event';
import {
  CLOCK,
  CORRELATION_CONTEXT,
  ID_GENERATOR,
  UNIT_OF_WORK,
} from '../../catalog.tokens';
import { ConflictError, NotFoundError } from '../../domain/errors';
import { MenuItem, normalizeMenuItemName } from '../../domain/menu-item';
import type { AdminMenuItemView, UnitOfWork } from '../ports/repositories';
import type { ClockPort, CorrelationContextPort, IdGeneratorPort } from '../ports/system';

export interface CreateMenuItemInput {
  categoryId: string;
  name: string;
  japaneseName?: string | null;
  description: string;
  priceCents: number;
  displayOrder: number;
  actorId: string | null;
}

@Injectable()
export class CreateMenuItemUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(CORRELATION_CONTEXT) private readonly correlation: CorrelationContextPort,
  ) {}

  async execute(input: CreateMenuItemInput): Promise<AdminMenuItemView> {
    const name = normalizeMenuItemName(input.name);

    return this.uow.run(async (repositories) => {
      const category = await repositories.categories.findById(input.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría indicada no existe');
      }

      const duplicate = await repositories.items.existsByNameInCategory(category.id, name);
      if (duplicate) {
        throw new ConflictError(`Ya existe un platillo llamado "${name}" en la categoría "${category.name}"`);
      }

      const now = this.clock.now();
      const item = MenuItem.createDraft({
        id: this.ids.uuid(),
        categoryId: category.id,
        name,
        japaneseName: input.japaneseName,
        description: input.description,
        priceCents: input.priceCents,
        displayOrder: input.displayOrder,
        updatedBy: input.actorId,
        now,
      });

      await repositories.items.create(item);
      await repositories.outbox.append(
        buildMenuItemUpdatedEvent({
          item,
          category,
          correlationId: this.correlation.correlationId(),
          messageId: this.ids.uuid(),
          occurredAt: now,
        }),
      );

      return { item, categoryName: category.name };
    });
  }
}
