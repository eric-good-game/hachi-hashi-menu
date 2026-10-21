import { Module } from '@nestjs/common';
import {
  ALLERGEN_REPOSITORY,
  CATEGORY_REPOSITORY,
  CLOCK,
  CORRELATION_CONTEXT,
  ID_GENERATOR,
  MENU_ITEM_REPOSITORY,
  UNIT_OF_WORK,
} from '../../catalog.tokens';
import { PrismaAllergenRepository } from './prisma-allergen.repository';
import { PrismaCategoryRepository } from './prisma-category.repository';
import { PrismaMenuItemRepository } from './prisma-menu-item.repository';
import { PrismaService } from './prisma.service';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import { SystemClock } from '../system/system-clock';
import { CryptoIdGenerator } from '../system/crypto-id-generator';
import { AsyncLocalStorageCorrelationContext } from '../system/async-local-storage-correlation-context';

@Module({
  providers: [
    PrismaService,
    {
      provide: CATEGORY_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaCategoryRepository(prisma),
    },
    {
      provide: MENU_ITEM_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaMenuItemRepository(prisma),
    },
    {
      provide: ALLERGEN_REPOSITORY,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new PrismaAllergenRepository(prisma),
    },
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: CryptoIdGenerator },
    { provide: CORRELATION_CONTEXT, useClass: AsyncLocalStorageCorrelationContext },
  ],
  exports: [
    PrismaService,
    CATEGORY_REPOSITORY,
    MENU_ITEM_REPOSITORY,
    ALLERGEN_REPOSITORY,
    UNIT_OF_WORK,
    CLOCK,
    ID_GENERATOR,
    CORRELATION_CONTEXT,
  ],
})
export class PersistenceModule {}
