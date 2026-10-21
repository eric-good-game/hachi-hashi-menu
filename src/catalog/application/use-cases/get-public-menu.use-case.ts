import { Inject, Injectable } from '@nestjs/common';
import { MENU_ITEM_REPOSITORY } from '../../catalog.tokens';
import type { MenuItemRepository } from '../ports/repositories';
import type { AppEnv } from '../../../config/env.schema';
import {
  toPublicMenuItemResponse,
  type PublicMenuItemResponse,
} from '../views/public-menu-item.view';

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

    return {
      categories: rows.map(({ category, items }) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        displayOrder: category.displayOrder,
        items: items.map((item) =>
          toPublicMenuItemResponse(
            item,
            { id: category.id, name: category.name },
            this.env.PUBLIC_BASE_URL,
          ),
        ),
      })),
    };
  }
}
