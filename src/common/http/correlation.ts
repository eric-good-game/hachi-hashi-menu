import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface CorrelationStore {
  correlationId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const storage = new AsyncLocalStorage<CorrelationStore>();

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const correlationId = incoming && UUID_PATTERN.test(incoming) ? incoming : randomUUID();

  res.setHeader('x-request-id', correlationId);
  storage.run({ correlationId }, next);
}

export function currentCorrelationId(): string {
  return storage.getStore()?.correlationId ?? randomUUID();
}
