import { Category } from '../catalog/domain/category';
import { MenuItem } from '../catalog/domain/menu-item';
import { buildMenuItemUpdatedEvent } from './build-menu-item-updated.event';

const NOW = new Date('2026-10-20T18:42:10.000Z');

describe('buildMenuItemUpdatedEvent', () => {
  it('construye la foto completa del platillo con los campos del contrato', () => {
    const category = Category.rehydrate({
      id: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
      name: 'Nigiri',
      slug: 'nigiri',
      displayOrder: 20,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const item = MenuItem.rehydrate({
      id: '3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10',
      categoryId: category.id,
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
      availableUpdatedAt: null,
      revision: 4,
      createdAt: NOW,
      updatedAt: NOW,
      updatedBy: null,
      allergens: ['pescado'],
    });

    const event = buildMenuItemUpdatedEvent({
      item,
      category,
      correlationId: '0b6f2a9e-41c5-4c0e-8f3a-2d7e9b1a5c33',
      messageId: '7c1f0e52-3b8a-4f6e-9d2a-5a1b6c0d9e11',
      occurredAt: NOW,
    });

    expect(event).toEqual({
      id: '7c1f0e52-3b8a-4f6e-9d2a-5a1b6c0d9e11',
      type: 'MenuItemUpdated',
      routingKey: 'menu.menu-item-updated',
      aggregateId: item.id,
      correlationId: '0b6f2a9e-41c5-4c0e-8f3a-2d7e9b1a5c33',
      causationId: null,
      version: 1,
      payload: {
        menuItemId: item.id,
        revision: 4,
        name: 'Nigiri de salmón',
        priceCents: 18900,
        currency: 'MXN',
        categoryId: category.id,
        categoryName: 'Nigiri',
        active: true,
      },
      occurredAt: NOW,
    });

    expect(Object.keys(event.payload).sort()).toEqual(
      ['active', 'categoryId', 'categoryName', 'currency', 'menuItemId', 'name', 'priceCents', 'revision'].sort(),
    );
  });
});
