import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, UNIT_OF_WORK } from '../../catalog.tokens';
import type {
  ApplyAvailabilityChangeInput,
  ApplyAvailabilityChangeResult,
  AvailabilityInboundPort,
} from '../ports/availability-inbound';
import type { UnitOfWork } from '../ports/repositories';
import type { ClockPort } from '../ports/system';

export type {
  ApplyAvailabilityChangeInput,
  ApplyAvailabilityChangeResult,
  AvailabilityChangeStatus,
} from '../ports/availability-inbound';

export const AVAILABILITY_CONSUMER = 'menu.inventory-events';

@Injectable()
export class ApplyAvailabilityChangeUseCase implements AvailabilityInboundPort {
  private readonly logger = new Logger(ApplyAvailabilityChangeUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(input: ApplyAvailabilityChangeInput): Promise<ApplyAvailabilityChangeResult> {
    return this.uow.run(async (repositories) => {
      if (await repositories.processedMessages.exists(input.messageId)) {
        return { status: 'duplicate', menuItemId: input.menuItemId };
      }

      const item = await repositories.items.findById(input.menuItemId);
      if (!item) {
        await repositories.processedMessages.markProcessed(
          input.messageId,
          AVAILABILITY_CONSUMER,
          this.clock.now(),
        );
        this.logger.warn(
          `Disponibilidad para un platillo desconocido: ${input.menuItemId} (mensaje ${input.messageId})`,
        );
        return { status: 'unknown', menuItemId: input.menuItemId };
      }

      if (item.isAvailabilityStale(input.occurredAt)) {
        await repositories.processedMessages.markProcessed(
          input.messageId,
          AVAILABILITY_CONSUMER,
          this.clock.now(),
        );
        return { status: 'stale', menuItemId: input.menuItemId };
      }

      const applied = await repositories.items.updateAvailability(
        input.menuItemId,
        input.available,
        input.occurredAt,
      );

      await repositories.processedMessages.markProcessed(
        input.messageId,
        AVAILABILITY_CONSUMER,
        this.clock.now(),
      );

      return { status: applied ? 'applied' : 'stale', menuItemId: input.menuItemId };
    });
  }
}
