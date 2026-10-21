import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppEnv } from '../../../config/env.schema';
import type { PhotoStoragePort } from '../../application/ports/photo-storage';
import { ValidationError } from '../../domain/errors';

const MAX_BYTES = 5 * 1024 * 1024;
const FILENAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

interface DetectedImage {
  extension: 'jpg' | 'png' | 'webp';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

function detectImage(data: Buffer): DetectedImage | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { extension: 'jpg', contentType: 'image/jpeg' };
  }
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (data.length >= 8 && data.subarray(0, 8).equals(pngSignature)) {
    return { extension: 'png', contentType: 'image/png' };
  }
  if (
    data.length >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { extension: 'webp', contentType: 'image/webp' };
  }
  return null;
}

function contentTypeFor(filename: string): string | null {
  if (filename.endsWith('.jpg')) return 'image/jpeg';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.webp')) return 'image/webp';
  return null;
}

@Injectable()
export class LocalDiskPhotoStorage implements PhotoStoragePort, OnModuleInit {
  private readonly directory: string;

  constructor(@Inject('APP_ENV') env: AppEnv) {
    this.directory = env.PHOTO_STORAGE_PATH;
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async save(_itemId: string, data: Buffer, _declaredContentType: string): Promise<string> {
    if (data.length === 0) {
      throw new ValidationError('La foto está vacía');
    }
    if (data.length > MAX_BYTES) {
      throw new ValidationError('La foto supera el límite de 5 MB (RN-10)', 'RN-10');
    }

    const detected = detectImage(data);
    if (!detected) {
      throw new ValidationError('La foto debe ser JPEG, PNG o WebP (RN-10)', 'RN-10');
    }

    const filename = `${randomUUID()}.${detected.extension}`;
    await writeFile(join(this.directory, filename), data);
    return filename;
  }

  async delete(filename: string): Promise<void> {
    if (!FILENAME_PATTERN.test(filename)) {
      return;
    }
    try {
      await unlink(join(this.directory, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async read(filename: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (!FILENAME_PATTERN.test(filename)) {
      return null;
    }
    const contentType = contentTypeFor(filename);
    if (!contentType) {
      return null;
    }
    try {
      const data = await readFile(join(this.directory, filename));
      return { data, contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
