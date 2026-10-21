import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { AppEnv } from '../config/env.schema';
import { PrismaService } from '../catalog/infrastructure/persistence/prisma.service';
import { seedDatabase } from './seed-data';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('APP_ENV') private readonly env: AppEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.SEED_ON_START) {
      this.logger.log('SEED_ON_START=false: no se ejecuta la semilla');
      return;
    }

    const result = await seedDatabase(this.prisma);
    this.logger.log(
      `Semilla aplicada: ${result.allergens} alérgenos, ` +
        `${result.categoriesCreated} categorías nuevas, ${result.categoriesExisting} ya existentes, ` +
        `${result.itemsCreated} platillos nuevos, ${result.itemsExisting} ya existentes`,
    );
  }
}
