import { Inject, Injectable } from '@nestjs/common';
import { MENU_ITEM_REPOSITORY } from '../../catalog.tokens';
import { NotFoundError } from '../../domain/errors';
import type { MenuItemRepository } from '../ports/repositories';
import type { AppEnv } from '../../../config/env.schema';
import {
  toPublicMenuItemResponse,
  type PublicMenuItemResponse,
} from '../views/public-menu-item.view';

@Injectable()
export class GetPublicItemUseCase {
  constructor(
    @Inject(MENU_ITEM_REPOSITORY) private readonly items: MenuItemRepository,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  async execute(itemId: string): Promise<PublicMenuItemResponse> {
    const view = await this.items.findPublicById(itemId);
    if (!view) {
      throw new NotFoundError('El platillo no existe o no está disponible en el menú público');
    }

    return toPublicMenuItemResponse(
      view.item,
      { id: view.item.categoryId, name: view.categoryName },
      this.env.PUBLIC_BASE_URL,
    );
  }
}
