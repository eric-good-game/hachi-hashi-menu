import { Module } from '@nestjs/common';
import { DevAuthGuard } from '../common/auth/dev-auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { ChangeItemStatusUseCase } from './application/use-cases/change-item-status.use-case';
import { CreateCategoryUseCase } from './application/use-cases/create-category.use-case';
import { CreateMenuItemUseCase } from './application/use-cases/create-menu-item.use-case';
import { GetPublicMenuUseCase } from './application/use-cases/get-public-menu.use-case';
import {
  ListAdminItemsUseCase,
  ListAllCategoriesUseCase,
  ListAllergensUseCase,
  ListCategoriesUseCase,
} from './application/use-cases/list-catalog.use-cases';
import { ReplaceAllergensUseCase } from './application/use-cases/replace-allergens.use-case';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { AdminMenuController } from './api/admin-menu.controller';
import { PublicMenuController } from './api/public-menu.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [PublicMenuController, AdminMenuController],
  providers: [
    CreateCategoryUseCase,
    CreateMenuItemUseCase,
    ReplaceAllergensUseCase,
    ChangeItemStatusUseCase,
    GetPublicMenuUseCase,
    ListCategoriesUseCase,
    ListAllCategoriesUseCase,
    ListAllergensUseCase,
    ListAdminItemsUseCase,
    DevAuthGuard,
    RolesGuard,
  ],
})
export class CatalogModule {}
