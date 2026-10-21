import { Injectable } from '@nestjs/common';
import type { TransactionRepositories, UnitOfWork } from '../../application/ports/repositories';
import { PrismaAllergenRepository } from './prisma-allergen.repository';
import { PrismaCategoryRepository } from './prisma-category.repository';
import { PrismaMenuItemRepository } from './prisma-menu-item.repository';
import { PrismaOutboxRepository } from './prisma-outbox.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (repositories: TransactionRepositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) =>
        work({
          categories: new PrismaCategoryRepository(tx),
          items: new PrismaMenuItemRepository(tx),
          allergens: new PrismaAllergenRepository(tx),
          outbox: new PrismaOutboxRepository(tx),
        }),
      { timeout: 15_000 },
    );
  }
}
