import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppEnv } from '../../config/env.schema';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { DevAuthGuard } from '../../common/auth/dev-auth.guard';
import { Roles, RolesGuard } from '../../common/auth/roles.guard';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { ChangeCategoryStatusUseCase } from '../application/use-cases/change-category-status.use-case';
import { ChangeItemStatusUseCase } from '../application/use-cases/change-item-status.use-case';
import { CreateCategoryUseCase } from '../application/use-cases/create-category.use-case';
import { CreateMenuItemUseCase } from '../application/use-cases/create-menu-item.use-case';
import { DeleteCategoryUseCase } from '../application/use-cases/delete-category.use-case';
import { DeleteItemPhotoUseCase } from '../application/use-cases/delete-item-photo.use-case';
import { ListAdminItemsUseCase, ListAllCategoriesUseCase } from '../application/use-cases/list-catalog.use-cases';
import { ReplaceAllergensUseCase } from '../application/use-cases/replace-allergens.use-case';
import { UpdateCategoryUseCase } from '../application/use-cases/update-category.use-case';
import { UpdateMenuItemUseCase } from '../application/use-cases/update-menu-item.use-case';
import { UploadItemPhotoUseCase } from '../application/use-cases/upload-item-photo.use-case';
import { toAdminMenuItemResponse, toCategoryResponse, type AdminMenuItemResponse, type CategoryResponse } from './mappers';
import { ChangeCategoryStatusDto } from './dto/change-category-status.dto';
import { ChangeItemStatusDto } from './dto/change-item-status.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { ListAdminItemsQueryDto } from './dto/list-admin-items.query';
import { ReplaceAllergensDto } from './dto/replace-allergens.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

@ApiTags('admin')
@ApiBearerAuth()
@Controller('menu/admin')
@UseGuards(DevAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMenuController {
  constructor(
    private readonly createCategoryUseCase: CreateCategoryUseCase,
    private readonly updateCategoryUseCase: UpdateCategoryUseCase,
    private readonly changeCategoryStatusUseCase: ChangeCategoryStatusUseCase,
    private readonly deleteCategoryUseCase: DeleteCategoryUseCase,
    private readonly listCategoriesUseCase: ListAllCategoriesUseCase,
    private readonly createMenuItemUseCase: CreateMenuItemUseCase,
    private readonly updateMenuItemUseCase: UpdateMenuItemUseCase,
    private readonly listAdminItemsUseCase: ListAdminItemsUseCase,
    private readonly replaceAllergensUseCase: ReplaceAllergensUseCase,
    private readonly changeItemStatusUseCase: ChangeItemStatusUseCase,
    private readonly uploadItemPhotoUseCase: UploadItemPhotoUseCase,
    private readonly deleteItemPhotoUseCase: DeleteItemPhotoUseCase,
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

  @Put('categories/:id')
  @ApiOperation({ summary: 'Edita el nombre y el orden de una categoría' })
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryResponse & { itemsUpdated: number }> {
    const result = await this.updateCategoryUseCase.execute({
      categoryId: id,
      name: dto.name,
      displayOrder: dto.displayOrder,
      actorId: user.sub,
    });
    return { ...toCategoryResponse(result.category), itemsUpdated: result.itemsUpdated };
  }

  @Patch('categories/:id/status')
  @ApiOperation({ summary: 'Activa o desactiva una categoría' })
  async changeCategoryStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeCategoryStatusDto,
  ): Promise<CategoryResponse> {
    const category = await this.changeCategoryStatusUseCase.execute({ categoryId: id, active: dto.active });
    return toCategoryResponse(category);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borra una categoría que nunca tuvo platillos' })
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteCategoryUseCase.execute(id);
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

  @Put('items/:id')
  @ApiOperation({ summary: 'Edita un platillo; exige la revisión actual' })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    const view = await this.updateMenuItemUseCase.execute({
      itemId: id,
      revision: dto.revision,
      name: dto.name,
      japaneseName: dto.japaneseName,
      description: dto.description,
      priceCents: dto.priceCents,
      categoryId: dto.categoryId,
      displayOrder: dto.displayOrder,
      actorId: user.sub,
    });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
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

  @Put('items/:id/photo')
  @ApiOperation({ summary: 'Sube o reemplaza la foto de un platillo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  async uploadPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    if (!file) {
      throw new BadRequestException('El archivo "file" es obligatorio');
    }

    const view = await this.uploadItemPhotoUseCase.execute({
      itemId: id,
      data: file.buffer,
      contentType: file.mimetype,
      actorId: user.sub,
    });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
  }

  @Delete('items/:id/photo')
  @ApiOperation({ summary: 'Quita la foto de un platillo' })
  async deletePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AdminMenuItemResponse> {
    const view = await this.deleteItemPhotoUseCase.execute({ itemId: id, actorId: user.sub });
    return toAdminMenuItemResponse(view, this.env.PUBLIC_BASE_URL);
  }
}
