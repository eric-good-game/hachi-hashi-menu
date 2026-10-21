import { Inject, Injectable } from '@nestjs/common';
import { MENU_ITEM_REPOSITORY } from '../../catalog.tokens';
import type { MenuItemRepository } from '../ports/repositories';
import type { AppEnv } from '../../../config/env.schema';
import {
  toPublicMenuItemResponse,
  type PublicMenuItemResponse,
} from '../views/public-menu-item.view';

export interface ListPublicItemsInput {
  categoryId?: string;
  available?: boolean;
  excludeAllergens?: string;
  q?: string;
  page: number;
  size: number;
}

export interface ListPublicItemsResponse {
  items: PublicMenuItemResponse[];
  page: number;
  size: number;
  total: number;
}

@Injectable()
export class ListPublicItemsUseCase {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly items: MenuItemRepository,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  async execute(input: ListPublicItemsInput): Promise<ListPublicItemsResponse> {
    const excludeAllergens = [
      ...new Set(
        (input.excludeAllergens ?? '')
          .split(',')
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ];

    const result = await this.items.listPublicItems({
      categoryId: input.categoryId,
      available: input.available,
      excludeAllergens,
      q: input.q?.trim() || undefined,
      page: input.page,
      size: input.size,
    });

    return {
      items: result.items.map(({ item, categoryName }) =>
        toPublicMenuItemResponse(item, { id: item.categoryId, name: categoryName }, this.env.PUBLIC_BASE_URL),
      ),
      page: input.page,
      size: input.size,
      total: result.total,
    };
  }
}
