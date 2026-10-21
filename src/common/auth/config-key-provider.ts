import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { AppEnv } from '../../config/env.schema';
import type { JwtKeyProviderPort } from './jwt-key-provider';

@Injectable()
export class ConfigKeyProvider implements JwtKeyProviderPort, OnModuleInit {
  private cachedKey: Promise<string> | null = null;

  constructor(@Inject('APP_ENV') private readonly env: AppEnv) {}

  async onModuleInit(): Promise<void> {
    if (this.env.AUTH_MODE === 'jwt') {
      await this.getPublicKey();
    }
  }

  async getPublicKey(): Promise<string> {
    if (!this.cachedKey) {
      this.cachedKey = this.loadKey();
    }
    return this.cachedKey;
  }

  private async loadKey(): Promise<string> {
    if (this.env.JWT_PUBLIC_KEY) {
      return this.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
    }
    if (this.env.JWT_PUBLIC_KEY_FILE) {
      return readFile(this.env.JWT_PUBLIC_KEY_FILE, 'utf8');
    }
    throw new Error('AUTH_MODE=jwt exige JWT_PUBLIC_KEY o JWT_PUBLIC_KEY_FILE');
  }
}
