import { Controller, Get, Headers, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { GetItemPhotoUseCase } from '../application/use-cases/get-item-photo.use-case';

@ApiTags('menu')
@Controller('menu/media')
export class MediaController {
  constructor(private readonly getItemPhoto: GetItemPhotoUseCase) {}

  @Get(':file')
  @ApiOperation({ summary: 'Sirve la foto de un platillo' })
  async getPhoto(
    @Param('file') file: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    const photo = await this.getItemPhoto.execute(file);
    const etag = `"${file}"`;

    response.setHeader('Content-Type', photo.contentType);
    response.setHeader('Cache-Control', 'public, max-age=60');
    response.setHeader('ETag', etag);

    if (ifNoneMatch && this.matches(ifNoneMatch, etag)) {
      response.status(304);
      return;
    }

    return new StreamableFile(photo.data);
  }

  private matches(header: string, etag: string): boolean {
    return header
      .split(',')
      .map((value) => value.trim())
      .some((value) => value === etag || value === '*');
  }
}
