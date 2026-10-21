import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AppEnv } from '../../config/env.schema';

/**
 * En modo integrado las herramientas de desarrollo no existen: se responde 404
 * antes de autenticar para no revelar la ruta.
 */
@Injectable()
export class DevToolsGuard implements CanActivate {
  constructor(@Inject('APP_ENV') private readonly env: AppEnv) {}

  canActivate(_context: ExecutionContext): boolean {
    if (!this.env.DEV_TOOLS_ENABLED) {
      throw new NotFoundException();
    }
    return true;
  }
}
