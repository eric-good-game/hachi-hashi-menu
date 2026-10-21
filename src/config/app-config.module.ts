import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from './env.schema';

@Global()
@Module({
  providers: [
    {
      provide: 'APP_ENV',
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): AppEnv => ({
        NODE_ENV: config.getOrThrow('NODE_ENV'),
        APP_MODE: config.getOrThrow('APP_MODE'),
        AUTH_MODE: config.getOrThrow('AUTH_MODE'),
        PORT: config.getOrThrow('PORT'),
        PUBLIC_BASE_URL: config.getOrThrow('PUBLIC_BASE_URL'),
        DATABASE_URL: config.getOrThrow('DATABASE_URL'),
        OUTBOX_PUBLISH_ENABLED: config.getOrThrow('OUTBOX_PUBLISH_ENABLED'),
        CONSUMERS_ENABLED: config.getOrThrow('CONSUMERS_ENABLED'),
        RABBITMQ_URL: config.get('RABBITMQ_URL'),
        OUTBOX_POLL_INTERVAL_MS: config.getOrThrow('OUTBOX_POLL_INTERVAL_MS'),
        OUTBOX_BATCH_SIZE: config.getOrThrow('OUTBOX_BATCH_SIZE'),
        CONSUMER_MAX_RETRIES: config.getOrThrow('CONSUMER_MAX_RETRIES'),
        JWT_PUBLIC_KEY: config.get('JWT_PUBLIC_KEY'),
        JWT_PUBLIC_KEY_FILE: config.get('JWT_PUBLIC_KEY_FILE'),
        DEV_TOOLS_ENABLED: config.getOrThrow('DEV_TOOLS_ENABLED'),
        SEED_ON_START: config.getOrThrow('SEED_ON_START'),
        PHOTO_STORAGE_PATH: config.getOrThrow('PHOTO_STORAGE_PATH'),
      }),
    },
  ],
  exports: ['APP_ENV'],
})
export class AppConfigModule {}
