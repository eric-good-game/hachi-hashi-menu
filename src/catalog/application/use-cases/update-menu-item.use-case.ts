import { Inject, Injectable } from '@nestjs/common';
import { buildMenuItemUpdatedEvent } from '../../../events/build-menu-item-updated.event';
import { CLOCK, CORRELATION_CONTEXT, ID_GENERATOR, UNIT_OF_WORK } from '../../catalog.tokens';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../domain/errors';
import { normalizeMenuItemName } from '../../domain/menu-item';
import type { AdminMenuItemView, UnitOfWork } from '../ports/repositories';
import type { ClockPort, CorrelationContextPort, IdGeneratorPort } from '../ports/system';

export interface UpdateMenuItemInput {
  itemId: string;
  revision: number;
  name?: string;
  japaneseName?: string | null;
  description?: string;
  priceCents?: number;
  categoryId?: string;
  displayOrder?: number;
  actorId: string | null;
}

@Injectable()
export class UpdateMenuItemUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(CORRELATION_CONTEXT) private readonly correlation: CorrelationContextPort,
  ) {}

  async execute(input: UpdateMenuItemInput): Promise<AdminMenuItemView> {
    return this.uow.run(async (repositories) => {
      const item = await repositories.items.findById(input.itemId);
      if (!item) {
        throw new NotFoundError('El platillo no existe');
      }

      item.assertRevision(input.revision);

      let targetCategory = await repositories.categories.findById(item.categoryId);
      if (!targetCategory) {
        throw new NotFoundError('La categoría del platillo no existe');
      }

      if (input.categoryId && input.categoryId !== item.categoryId) {
        const category = await repositories.categories.findById(input.categoryId);
        if (!category) {
          throw new NotFoundError('La categoría indicada no existe');
        }
        if (item.active && !category.active) {
          throw new BusinessRuleError(
            'No se puede mover un platillo activo a una categoría inactiva (RN-06)',
            'RN-06',
          );
        }
        targetCategory = category;
      }

      const nextName = input.name !== undefined ? normalizeMenuItemName(input.name) : item.name;
      const categoryChanged = targetCategory.id !== item.categoryId;
      if (nextName !== item.name || categoryChanged) {
        const duplicate = await repositories.items.existsByNameInCategory(targetCategory.id, nextName, item.id);
        if (duplicate) {
          throw new ConflictError(
            `Ya existe un platillo llamado "${nextName}" en la categoría "${targetCategory.name}"`,
          );
        }
      }

      const now = this.clock.now();
      const updated = item.updateDetails(
        {
          name: input.name,
          japaneseName: input.japaneseName,
          description: input.description,
          priceCents: input.priceCents,
          categoryId: targetCategory.id,
          displayOrder: input.displayOrder,
        },
        now,
        input.actorId,
      );

      if (updated === item) {
        return { item, categoryName: targetCategory.name };
      }

      await repositories.items.updateDetails(updated);

      if (updated.revision !== item.revision) {
        await repositories.outbox.append(
          buildMenuItemUpdatedEvent({
            item: updated,
            category: targetCategory,
            correlationId: this.correlation.correlationId(),
            messageId: this.ids.uuid(),
            occurredAt: now,
          }),
        );
      }

      return { item: updated, categoryName: targetCategory.name };
    });
  }
}
