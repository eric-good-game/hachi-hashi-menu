import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, PHOTO_STORAGE, UNIT_OF_WORK } from '../../catalog.tokens';
import { NotFoundError } from '../../domain/errors';
import type { AdminMenuItemView, UnitOfWork } from '../ports/repositories';
import type { PhotoStoragePort } from '../ports/photo-storage';
import type { ClockPort } from '../ports/system';

export interface DeleteItemPhotoInput {
  itemId: string;
  actorId: string | null;
}

@Injectable()
export class DeleteItemPhotoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStoragePort,
  ) {}

  async execute(input: DeleteItemPhotoInput): Promise<AdminMenuItemView> {
    let previousPhoto: string | null = null;

    const view = await this.uow.run(async (repositories) => {
      const item = await repositories.items.findById(input.itemId);
      if (!item) {
        throw new NotFoundError('El platillo no existe');
      }

      const category = await repositories.categories.findById(item.categoryId);
      if (!category) {
        throw new NotFoundError('La categoría del platillo no existe');
      }

      previousPhoto = item.photoPath;
      if (!previousPhoto) {
        return { item, categoryName: category.name };
      }

      const now = this.clock.now();
      const updated = item.withPhoto(null, now, input.actorId);
      await repositories.items.updatePhoto(item.id, null, input.actorId, now);
      return { item: updated, categoryName: category.name };
    });

    if (previousPhoto) {
      try {
        await this.storage.delete(previousPhoto);
      } catch {
        // La base ya quedó sin foto; se evita fallar por un archivo huérfano.
      }
    }

    return view;
  }
}
