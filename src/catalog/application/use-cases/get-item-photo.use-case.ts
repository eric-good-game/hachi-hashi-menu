import { Inject, Injectable } from '@nestjs/common';
import { PHOTO_STORAGE } from '../../catalog.tokens';
import { NotFoundError } from '../../domain/errors';
import type { PhotoStoragePort } from '../ports/photo-storage';

@Injectable()
export class GetItemPhotoUseCase {
  constructor(@Inject(PHOTO_STORAGE) private readonly storage: PhotoStoragePort) {}

  async execute(filename: string): Promise<{ data: Buffer; contentType: string }> {
    const photo = await this.storage.read(filename);
    if (!photo) {
      throw new NotFoundError('La foto no existe');
    }
    return photo;
  }
}
