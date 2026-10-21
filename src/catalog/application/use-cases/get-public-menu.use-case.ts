import { Inject, Injectable } from '@nestjs/common';
import { MENU_ITEM_REPOSITORY } from '../../catalog.tokens';
import type { MenuItemRepository } from '../ports/repositories';
import type { AppEnv } from '../../../config/env.schema';

export interface PublicMenuItemResponse {
  id: string;
  name: string;
  japaneseName: string | null;
  description: string;
  priceCents: number;
  currency: string;
  category: { id: string; name: string };
  allergens: string[];
  photoUrl: string | null;
  available: boolean;
}

export interface PublicMenuCategoryResponse {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  items: PublicMenuItemResponse[];
}

export interface PublicMenuResponse {
  categories: PublicMenuCategoryResponse[];
}

@Injectable()
export class GetPublicMenuUseCase {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly items: MenuItemRepository,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  async execute(): Promise<PublicMenuResponse> {
    const rows = await this.items.listPublicMenu();
    const baseUrl = this.env.PUBLIC_BASE_URL.replace(/\/+$/, '');

    return {
      categories: rows.map(({ category, items }) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        displayOrder: category.displayOrder,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          japaneseName: item.japaneseName,
          description: item.description,
          priceCents: item.priceCents,
          currency: item.currency,
          category: { id: category.id, name: category.name },
          allergens: [...item.allergens],
          photoUrl: item.photoPath ? `${baseUrl}/api/menu/media/${encodeURIComponent(item.photoPath)}` : null,
          available: item.available,
        })),
      })),
    };
  }
}
