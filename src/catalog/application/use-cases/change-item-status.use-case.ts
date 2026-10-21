import { Inject, Injectable } from '@nestjs/common';
import { buildMenuItemUpdatedEvent } from '../../../events/build-menu-item-updated.event';
import { CLOCK, CORRELATION_CONTEXT, ID_GENERATOR, UNIT_OF_WORK } from '../../catalog.tokens';
import { NotFoundError } from '../../domain/errors';
import type { AdminMenuItemView, UnitOfWork } from '../ports/repositories';
import type { ClockPort, CorrelationContextPort, IdGeneratorPort } from '../ports/system';

export interface ChangeItemStatusInput {
  itemId: string;
  active: boolean;
  revision: number;
  actorId: string | null;
}

@Injectable()
export class ChangeItemStatusUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(CORRELATION_CONTEXT) private readonly correlation: CorrelationContextPort,
  ) {}

  async execute(input: ChangeItemStatusInput): Promise<AdminMenuItemView> {
    return this.uow.run(async (repositories) => {
      const item = await repositories.items.findById(input.itemId);
      if (!item) {
        throw new NotFoundError('El platillo no existe');
      }

      item.assertRevision(input.revision);

      const category = await repositories.categories.findById(item.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría del platillo no existe');
      }

      const now = this.clock.now();
      const updated = input.active
        ? item.activate(category, now, input.actorId)
        : item.deactivate(now, input.actorId);

      if (updated.revision === item.revision) {
        return { item: updated, categoryName: category.name };
      }

      await repositories.items.update(updated);
      await repositories.outbox.append(
        buildMenuItemUpdatedEvent({
          item: updated,
          category,
          correlationId: this.correlation.correlationId(),
          messageId: this.ids.uuid(),
          occurredAt: now,
        }),
      );

      return { item: updated, categoryName: category.name };
    });
  }
}
