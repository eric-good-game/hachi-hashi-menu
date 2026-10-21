import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { AppEnv } from '../../config/env.schema';
import { DevAuthGuard } from './dev-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject('APP_ENV') private readonly env: AppEnv,
    private readonly devGuard: DevAuthGuard,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    return this.env.AUTH_MODE === 'dev'
      ? this.devGuard.canActivate(context)
      : this.jwtGuard.canActivate(context);
  }
}
