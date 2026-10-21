import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verify, type JwtPayload } from 'jsonwebtoken';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env.schema';
import type { AuthenticatedUser } from './auth.types';
import { JWT_KEY_PROVIDER, type JwtKeyProviderPort } from './jwt-key-provider';

export function extractRoles(payload: JwtPayload): string[] {
  if (Array.isArray(payload.roles)) {
    return payload.roles.filter((role): role is string => typeof role === 'string');
  }

  const realmRoles = (payload as JwtPayload & { realm_access?: { roles?: unknown } }).realm_access?.roles;
  if (Array.isArray(realmRoles)) {
    return realmRoles.filter((role): role is string => typeof role === 'string');
  }

  return [];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject('APP_ENV') private readonly env: AppEnv,
    @Inject(JWT_KEY_PROVIDER) private readonly keys: JwtKeyProviderPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.env.AUTH_MODE !== 'jwt') {
      throw new UnauthorizedException('Modo de autenticación no soportado');
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;

    if (!token) {
      throw new UnauthorizedException('Token JWT ausente');
    }

    try {
      const publicKey = await this.keys.getPublicKey();
      const payload = verify(token, publicKey, { algorithms: ['RS256'] });

      if (typeof payload === 'string' || typeof payload.sub !== 'string') {
        throw new Error('El token no contiene sub');
      }

      request.user = {
        sub: payload.sub,
        roles: extractRoles(payload),
      };
      return true;
    } catch {
      throw new UnauthorizedException('Token JWT inválido o expirado');
    }
  }
}
