import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { ConfigKeyProvider } from '../common/auth/config-key-provider';
import { DevAuthGuard } from '../common/auth/dev-auth.guard';
import { DevToolsGuard } from '../common/auth/dev-tools.guard';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { JWT_KEY_PROVIDER } from '../common/auth/jwt-key-provider';
import { RolesGuard } from '../common/auth/roles.guard';
import { ApplyAvailabilityChangeUseCase } from './application/use-cases/apply-availability-change.use-case';
import { AVAILABILITY_INBOUND } from './catalog.tokens';
import { ChangeCategoryStatusUseCase } from './application/use-cases/change-category-status.use-case';
import { ChangeItemStatusUseCase } from './application/use-cases/change-item-status.use-case';
import { CreateCategoryUseCase } from './application/use-cases/create-category.use-case';
import { CreateMenuItemUseCase } from './application/use-cases/create-menu-item.use-case';
import { DeleteCategoryUseCase } from './application/use-cases/delete-category.use-case';
import { DeleteItemPhotoUseCase } from './application/use-cases/delete-item-photo.use-case';
import { GetItemPhotoUseCase } from './application/use-cases/get-item-photo.use-case';
import { GetPublicItemUseCase } from './application/use-cases/get-public-item.use-case';
import { GetPublicMenuUseCase } from './application/use-cases/get-public-menu.use-case';
import {
  ListAdminItemsUseCase,
  ListAllCategoriesUseCase,
  ListAllergensUseCase,
  ListCategoriesUseCase,
} from './application/use-cases/list-catalog.use-cases';
import { ListPublicItemsUseCase } from './application/use-cases/list-public-items.use-case';
import { ReplaceAllergensUseCase } from './application/use-cases/replace-allergens.use-case';
import { UpdateCategoryUseCase } from './application/use-cases/update-category.use-case';
import { UpdateMenuItemUseCase } from './application/use-cases/update-menu-item.use-case';
import { UploadItemPhotoUseCase } from './application/use-cases/upload-item-photo.use-case';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { AdminMenuController } from './api/admin-menu.controller';
import { DevAvailabilityController } from './api/dev-availability.controller';
import { MediaController } from './api/media.controller';
import { PublicMenuController } from './api/public-menu.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [PublicMenuController, MediaController, AdminMenuController, DevAvailabilityController],
  providers: [
    CreateCategoryUseCase,
    UpdateCategoryUseCase,
    ChangeCategoryStatusUseCase,
    DeleteCategoryUseCase,
    CreateMenuItemUseCase,
    UpdateMenuItemUseCase,
    ReplaceAllergensUseCase,
    ChangeItemStatusUseCase,
    UploadItemPhotoUseCase,
    DeleteItemPhotoUseCase,
    GetItemPhotoUseCase,
    GetPublicMenuUseCase,
    ListCategoriesUseCase,
    ListAllCategoriesUseCase,
    ListAllergensUseCase,
    ListAdminItemsUseCase,
    ListPublicItemsUseCase,
    GetPublicItemUseCase,
    ApplyAvailabilityChangeUseCase,
    {
      provide: AVAILABILITY_INBOUND,
      useExisting: ApplyAvailabilityChangeUseCase,
    },
    DevAuthGuard,
    AuthGuard,
    JwtAuthGuard,
    DevToolsGuard,
    RolesGuard,
    {
      provide: JWT_KEY_PROVIDER,
      useClass: ConfigKeyProvider,
    },
  ],
  exports: [ApplyAvailabilityChangeUseCase, AVAILABILITY_INBOUND],
})
export class CatalogModule {}
