import { Controller, Get, ParseUUIDPipe, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPublicMenuUseCase, type PublicMenuResponse } from '../application/use-cases/get-public-menu.use-case';
import {
  ListAllergensUseCase,
  ListCategoriesUseCase,
} from '../application/use-cases/list-catalog.use-cases';
import {
  ListPublicItemsUseCase,
  type ListPublicItemsResponse,
} from '../application/use-cases/list-public-items.use-case';
import { GetPublicItemUseCase } from '../application/use-cases/get-public-item.use-case';
import type { Allergen } from '../application/ports/repositories';
import type { PublicMenuItemResponse } from '../application/views/public-menu-item.view';
import type { Category } from '../domain/category';
import { PublicCacheInterceptor } from '../../common/http/public-cache.interceptor';
import { ListPublicItemsQueryDto } from './dto/list-public-items.query';
import { toCategoryResponse, type CategoryResponse } from './mappers';

@ApiTags('menu')
@Controller('menu')
@UseInterceptors(PublicCacheInterceptor)
export class PublicMenuController {
  constructor(
    private readonly getPublicMenu: GetPublicMenuUseCase,
    private readonly listCategories: ListCategoriesUseCase,
    private readonly listAllergens: ListAllergensUseCase,
    private readonly listPublicItems: ListPublicItemsUseCase,
    private readonly getPublicItem: GetPublicItemUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Menú completo: categorías activas con platillos activos' })
  @ApiOkResponse({ description: 'Menú vigente' })
  getMenu(): Promise<PublicMenuResponse> {
    return this.getPublicMenu.execute();
  }

  @Get('categories')
  @ApiOperation({ summary: 'Categorías activas' })
  async getCategories(): Promise<CategoryResponse[]> {
    const categories: Category[] = await this.listCategories.execute();
    return categories.map(toCategoryResponse);
  }

  @Get('allergens')
  @ApiOperation({ summary: 'Catálogo de alérgenos' })
  getAllergens(): Promise<Allergen[]> {
    return this.listAllergens.execute();
  }

  @Get('items')
  @ApiOperation({ summary: 'Platillos activos con filtros y paginación' })
  getItems(@Query() query: ListPublicItemsQueryDto): Promise<ListPublicItemsResponse> {
    return this.listPublicItems.execute(query);
  }

  @Get('items/:id')
  @ApiOperation({ summary: 'Detalle público de un platillo activo' })
  getItem(@Param('id', ParseUUIDPipe) id: string): Promise<PublicMenuItemResponse> {
    return this.getPublicItem.execute(id);
  }
}
