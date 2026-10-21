import { Inject, Injectable } from '@nestjs/common';
import { ALLERGEN_REPOSITORY, CATEGORY_REPOSITORY, MENU_ITEM_REPOSITORY } from '../../catalog.tokens';
import type { Category } from '../../domain/category';
import type {
  AdminMenuItemView,
  Allergen,
  AllergenRepository,
  CategoryRepository,
  MenuItemRepository,
} from '../ports/repositories';

@Injectable()
export class ListCategoriesUseCase {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository) {}

  execute(): Promise<Category[]> {
    return this.categories.listActive();
  }
}

@Injectable()
export class ListAllCategoriesUseCase {
  constructor(@Inject(CATEGORY_REPOSITORY) private readonly categories: CategoryRepository) {}

  execute(): Promise<Category[]> {
    return this.categories.listAll();
  }
}

@Injectable()
export class ListAllergensUseCase {
  constructor(@Inject(ALLERGEN_REPOSITORY) private readonly allergens: AllergenRepository) {}

  execute(): Promise<Allergen[]> {
    return this.allergens.list();
  }
}

@Injectable()
export class ListAdminItemsUseCase {
  constructor(@Inject(MENU_ITEM_REPOSITORY) private readonly items: MenuItemRepository) {}

  execute(page: number, size: number): Promise<{ items: AdminMenuItemView[]; total: number }> {
    return this.items.listAdmin(page, size);
  }
}
