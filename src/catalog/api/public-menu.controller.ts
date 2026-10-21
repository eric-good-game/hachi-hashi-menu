import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetPublicMenuUseCase, type PublicMenuResponse } from '../application/use-cases/get-public-menu.use-case';
import {
  ListAllergensUseCase,
  ListCategoriesUseCase,
} from '../application/use-cases/list-catalog.use-cases';
import type { Allergen } from '../application/ports/repositories';
import type { Category } from '../domain/category';
import { PublicCacheInterceptor } from '../../common/http/public-cache.interceptor';
import { toCategoryResponse, type CategoryResponse } from './mappers';

@ApiTags('menu')
@Controller('menu')
@UseInterceptors(PublicCacheInterceptor)
export class PublicMenuController {
  constructor(
    private readonly getPublicMenu: GetPublicMenuUseCase,
    private readonly listCategories: ListCategoriesUseCase,
    private readonly listAllergens: ListAllergensUseCase,
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
}
