import { Module } from '@nestjs/common';
import { PersistenceModule } from '../catalog/infrastructure/persistence/persistence.module';
import { HealthController } from './health.controller';

@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
})
export class HealthModule {}
