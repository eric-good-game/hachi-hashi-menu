import { Module } from '@nestjs/common';
import type { AppEnv } from '../config/env.schema';
import { EVENT_BUS } from '../catalog/catalog.tokens';
import type { EventBusPort } from '../catalog/application/ports/event-bus';
import { CatalogModule } from '../catalog/catalog.module';
import { PersistenceModule } from '../catalog/infrastructure/persistence/persistence.module';
import { ContractValidator } from '../events/contract-validator';
import { OutboxRelay } from './application/outbox-relay.service';
import { LoggingEventBus } from './infrastructure/logging-event-bus';
import { RabbitMqAvailabilityConsumer } from './infrastructure/rabbitmq/rabbitmq-availability.consumer';
import { RabbitMqEventBus } from './infrastructure/rabbitmq/rabbitmq-event-bus';
import { RabbitMqService } from './infrastructure/rabbitmq/rabbitmq.service';

@Module({
  imports: [PersistenceModule, CatalogModule],
  providers: [
    ContractValidator,
    RabbitMqService,
    RabbitMqEventBus,
    LoggingEventBus,
    {
      provide: EVENT_BUS,
      inject: [RabbitMqEventBus, LoggingEventBus, 'APP_ENV'],
      useFactory: (
        rabbit: RabbitMqEventBus,
        logging: LoggingEventBus,
        env: AppEnv,
      ): EventBusPort => (env.OUTBOX_PUBLISH_ENABLED ? rabbit : logging),
    },
    OutboxRelay,
    RabbitMqAvailabilityConsumer,
  ],
})
export class MessagingModule {}
