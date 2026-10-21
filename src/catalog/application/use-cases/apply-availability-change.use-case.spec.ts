import type {
  MenuItemRepository,
  ProcessedMessageRepository,
  TransactionRepositories,
  UnitOfWork,
} from '../ports/repositories';
import type { ClockPort } from '../ports/system';
import { MenuItem } from '../../domain/menu-item';
import {
  ApplyAvailabilityChangeUseCase,
  AVAILABILITY_CONSUMER,
} from './apply-availability-change.use-case';

const NOW = new Date('2026-10-20T18:42:10.000Z');
const LATER = new Date('2026-10-20T19:10:00.000Z');
const ITEM_ID = '3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10';
const MESSAGE_ID = 'd6a0b6e4-6d3b-4b8e-9d6f-1a2b3c4d5e6f';

function item(availableUpdatedAt: Date | null = null): MenuItem {
  return MenuItem.rehydrate({
    id: ITEM_ID,
    categoryId: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
    name: 'Nigiri de salmón',
    japaneseName: null,
    description: 'Salmón fresco',
    priceCents: 18900,
    currency: 'MXN',
    photoPath: null,
    displayOrder: 10,
    active: true,
    allergensReviewed: true,
    available: true,
    availableUpdatedAt,
    revision: 4,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: null,
    allergens: ['pescado'],
  });
}

function build(input: {
  found: MenuItem | null;
  alreadyProcessed?: boolean;
  updateApplied?: boolean;
}) {
  const processed: ProcessedMessageRepository = {
    exists: jest.fn().mockResolvedValue(input.alreadyProcessed ?? false),
    markProcessed: jest.fn().mockResolvedValue(undefined),
  };
  const items = {
    findById: jest.fn().mockResolvedValue(input.found),
    updateAvailability: jest.fn().mockResolvedValue(input.updateApplied ?? true),
  } as unknown as MenuItemRepository;
  const repositories = { items, processedMessages: processed } as unknown as TransactionRepositories;
  const uow: UnitOfWork = {
    run: (work) => work(repositories),
  };
  const clock: ClockPort = { now: () => NOW };

  return {
    useCase: new ApplyAvailabilityChangeUseCase(uow, clock),
    processed,
    items,
  };
}

const command = {
  messageId: MESSAGE_ID,
  menuItemId: ITEM_ID,
  available: false,
  occurredAt: LATER,
};

describe('ApplyAvailabilityChangeUseCase', () => {
  it('aplica la disponibilidad y registra el mensaje en la misma transacción', async () => {
    const { useCase, processed, items } = build({ found: item() });

    await expect(useCase.execute(command)).resolves.toEqual({
      status: 'applied',
      menuItemId: ITEM_ID,
    });

    expect(items.updateAvailability).toHaveBeenCalledWith(ITEM_ID, false, LATER);
    expect(processed.markProcessed).toHaveBeenCalledWith(MESSAGE_ID, AVAILABILITY_CONSUMER, NOW);
  });

  it('ignora un mensaje ya procesado sin volver a escribir', async () => {
    const { useCase, processed, items } = build({ found: item(), alreadyProcessed: true });

    await expect(useCase.execute(command)).resolves.toEqual({
      status: 'duplicate',
      menuItemId: ITEM_ID,
    });

    expect(items.findById).not.toHaveBeenCalled();
    expect(items.updateAvailability).not.toHaveBeenCalled();
    expect(processed.markProcessed).not.toHaveBeenCalled();
  });

  it('descarta disponibilidad vieja o con el mismo occurredAt', async () => {
    const { useCase, processed, items } = build({ found: item(LATER) });

    await expect(useCase.execute(command)).resolves.toEqual({
      status: 'stale',
      menuItemId: ITEM_ID,
    });

    expect(items.updateAvailability).not.toHaveBeenCalled();
    expect(processed.markProcessed).toHaveBeenCalled();
  });

  it('confirma y registra un platillo desconocido', async () => {
    const { useCase, processed, items } = build({ found: null });

    await expect(useCase.execute(command)).resolves.toEqual({
      status: 'unknown',
      menuItemId: ITEM_ID,
    });

    expect(items.updateAvailability).not.toHaveBeenCalled();
    expect(processed.markProcessed).toHaveBeenCalledWith(MESSAGE_ID, AVAILABILITY_CONSUMER, NOW);
  });

  it('trata como vieja una actualización que perdió contra otra concurrente', async () => {
    const { useCase, processed } = build({ found: item(), updateApplied: false });

    await expect(useCase.execute(command)).resolves.toEqual({
      status: 'stale',
      menuItemId: ITEM_ID,
    });

    expect(processed.markProcessed).toHaveBeenCalled();
  });
});
