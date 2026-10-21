import type { Category } from '../catalog/domain/category';
import type { MenuItem } from '../catalog/domain/menu-item';
import type { NewOutboxEvent } from '../catalog/application/ports/repositories';
import {
  MENU_EVENT_VERSION,
  MENU_ITEM_UPDATED,
  MENU_ITEM_UPDATED_ROUTING_KEY,
  type MenuItemUpdatedPayload,
} from './menu-item-updated.contract';

export function buildMenuItemUpdatedEvent(input: {
  item: MenuItem;
  category: Category;
  correlationId: string;
  messageId: string;
  occurredAt: Date;
}): NewOutboxEvent {
  const payload: MenuItemUpdatedPayload = {
    menuItemId: input.item.id,
    revision: input.item.revision,
    name: input.item.name,
    priceCents: input.item.priceCents,
    currency: input.item.currency,
    categoryId: input.category.id,
    categoryName: input.category.name,
    active: input.item.active,
  };

  return {
    id: input.messageId,
    type: MENU_ITEM_UPDATED,
    routingKey: MENU_ITEM_UPDATED_ROUTING_KEY,
    aggregateId: input.item.id,
    correlationId: input.correlationId,
    causationId: null,
    version: MENU_EVENT_VERSION,
    payload: { ...payload } as Record<string, unknown>,
    occurredAt: input.occurredAt,
  };
}
