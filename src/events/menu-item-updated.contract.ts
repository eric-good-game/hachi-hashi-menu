export const MENU_ITEM_UPDATED = 'MenuItemUpdated';
export const MENU_ITEM_UPDATED_ROUTING_KEY = 'menu.menu-item-updated';
export const MENU_EVENT_VERSION = 1;

export interface MenuItemUpdatedPayload {
  menuItemId: string;
  revision: number;
  name: string;
  priceCents: number;
  currency: string;
  categoryId: string;
  categoryName: string;
  active: boolean;
}
