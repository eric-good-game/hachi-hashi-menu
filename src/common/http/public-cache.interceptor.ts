import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EMPTY, Observable, mergeMap, of } from 'rxjs';
import type { Request, Response } from 'express';

const CACHE_CONTROL = 'public, max-age=60';

@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      mergeMap((body) => {
        const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
        response.setHeader('ETag', etag);
        response.setHeader('Cache-Control', CACHE_CONTROL);

        const ifNoneMatch = request.header('if-none-match');
        if (ifNoneMatch && this.matches(ifNoneMatch, etag)) {
          response.status(304).end();
          return EMPTY;
        }

        return of(body);
      }),
    );
  }

  private matches(header: string, etag: string): boolean {
    return header
      .split(',')
      .map((value) => value.trim())
      .some((value) => value === etag || value === '*');
  }
}
