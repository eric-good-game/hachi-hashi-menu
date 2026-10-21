import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env.schema';
import {
  DEV_ADMIN_ID,
  DEV_ADMIN_TOKEN,
  DEV_VIEWER_ID,
  DEV_VIEWER_TOKEN,
  type AuthenticatedUser,
} from './auth.types';

/**
 * Adaptador de autenticación para la etapa A. En la etapa B se reemplaza por
 * la validación JWT con la clave pública de Identity.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  constructor(@Inject('APP_ENV') private readonly env: AppEnv) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.env.AUTH_MODE !== 'dev') {
      throw new UnauthorizedException('Modo de autenticación no soportado');
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

    const user = this.resolveUser(token);
    if (!user) {
      throw new UnauthorizedException('Token de desarrollo inválido o ausente');
    }

    request.user = user;
    return true;
  }

  private resolveUser(token: string | undefined): AuthenticatedUser | null {
    if (token === DEV_ADMIN_TOKEN) {
      return { sub: DEV_ADMIN_ID, roles: ['admin'] };
    }
    if (token === DEV_VIEWER_TOKEN) {
      return { sub: DEV_VIEWER_ID, roles: ['viewer'] };
    }
    return null;
  }
}
