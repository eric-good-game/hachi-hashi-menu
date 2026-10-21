export const EVENTS_EXCHANGE = 'hachi.events';
export const DEAD_LETTER_EXCHANGE = 'hachi.dlx';
export const RETRY_EXCHANGE = 'hachi.retry';

export const AVAILABILITY_ROUTING_KEY = 'inventory.menu-item-availability-changed';
export const AVAILABILITY_QUEUE = 'menu.inventory-events';
export const AVAILABILITY_DLQ_ROUTING_KEY = 'menu.inventory-events.dlq';
export const AVAILABILITY_DLQ = 'menu.inventory-events.dlq';

export interface RetryQueue {
  queue: string;
  routingKey: string;
  ttlMs: number;
}

export const AVAILABILITY_RETRY_QUEUES: readonly RetryQueue[] = [
  {
    queue: 'menu.inventory-events.retry.1',
    routingKey: 'availability.retry.1',
    ttlMs: 5_000,
  },
  {
    queue: 'menu.inventory-events.retry.2',
    routingKey: 'availability.retry.2',
    ttlMs: 15_000,
  },
  {
    queue: 'menu.inventory-events.retry.3',
    routingKey: 'availability.retry.3',
    ttlMs: 45_000,
  },
];

export function retryQueueForAttempt(attempt: number): RetryQueue {
  return AVAILABILITY_RETRY_QUEUES[Math.min(Math.max(attempt, 0), AVAILABILITY_RETRY_QUEUES.length - 1)]!;
}
