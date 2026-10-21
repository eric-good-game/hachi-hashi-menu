import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppEnv } from '../../config/env.schema';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DevAuthGuard } from '../../common/auth/dev-auth.guard';
import { Roles, RolesGuard } from '../../common/auth/roles.guard';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { ChangeItemStatusUseCase } from '../application/use-cases/change-item-status.use-case';
import { CreateCategoryUseCase } from '../application/use-cases/create-category.use-case';
import { CreateMenuItemUseCase } from '../application/use-cases/create-menu-item.use-case';
import { ListAdminItemsUseCase, ListAllCategoriesUseCase } from '../application/use-cases/list-catalog.use-cases';
import { ReplaceAllergensUseCase } from '../application/use-cases/replace-allergens.use-case';
import { toAdminMenuItemResponse, toCategoryResponse, type AdminMenuItemResponse, type CategoryResponse } from './mappers';
import { ChangeItemStatusDto } from './dto/change-item-status.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { ListAdminItemsQueryDto } from './dto/list-admin-items.query';
import { ReplaceAllergensDto } from './dto/replace-allergens.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('menu/admin')
@UseGuards(DevAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMenuController {
  constructor(
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly listCategoriesUseCase: ListAllCategoriesUseCase,
    private readonly createMenuItemUseCase: CreateMenuItemUseCase,
    private readonly listAdminItemsUseCase: ListAdminItemsUseCase,
    private readonly replaceAllergensUseCase: ReplaceAllergensUseCase,
    private readonly changeItemStatusUseCase: ChangeItemStatusUseCase,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  @Post('categories')
  @ApiOperation({ summary: 'Crea una categoría' })
  async createCategory(@Body() dto: CreateCategoryDto): Promise<CategoryResponse> {
    const category = await this.createCategoryUseCase.execute(dto);
    return toCategoryResponse(category);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Lista todas las categorías, incluidas las inactivas' })
  async listCategories(): Promise<CategoryResponse[]> {
    const categories = await this.listCategoriesUseCase.execute();
    return categories.map(toCategoryResponse);
  }

  @Post('items')
  @ApiOperation({ summary: 'Crea un platillo en borrador' })
  async createItem(
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    const view = await this.createMenuItemUseCase.execute({ ...dto, actorId: user.sub });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
  }

  @Get('items')
  @ApiOperation({ summary: 'Lista todos los platillos, incluidos borradores e inactivos' })
  async listItems(@Query() query: ListAdminItemsQueryDto): Promise<{
    items: AdminMenuItemResponse[];
    page: number;
    size: number;
    total: number;
  }> {
    const result = await this.listAdminItemsUseCase.execute(query.page, query.size);
    return {
      items: result.items.map((view) => toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL)),
      page: query.page,
      size: query.size,
      total: result.total,
    };
  }

  @Put('items/:id/allergens')
  @ApiOperation({ summary: 'Reemplaza los alérgenos y marca la revisión' })
  async replaceAllergens(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceAllergensDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    const view = await this.replaceAllergensUseCase.execute({
      itemId: id,
      allergenCodes: dto.allergenCodes,
      actorId: user.sub,
    });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
  }

  @Patch('items/:id/status')
  @ApiOperation({ summary: 'Activa o desactiva un platillo' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeItemStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    const view = await this.changeItemStatusUseCase.execute({
      itemId: id,
      active: dto.active,
      revision: dto.revision,
      actorId: user.sub,
    });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
  }
}
