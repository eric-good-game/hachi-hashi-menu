import { Module } from '@nestjs/common';
import { PersistenceModule } from '../catalog/infrastructure/persistence/persistence.module';
import { SeedService } from './seed.service';

@Module({
  imports: [PersistenceModule],
  providers: [SeedService],
})
export class SeedModule {}
