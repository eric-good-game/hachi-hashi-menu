import { Injectable } from '@nestjs/common';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EventEnvelope<TPayload extends object> {
  messageId: string;
  type: string;
  version: number;
  occurredAt: string;
  source: string;
  correlationId: string;
  causationId: string | null;
  payload: TPayload;
}

export interface MenuItemUpdatedPayload {
  menuItemId: string;
  revision: number;
  name: string;
  priceCents: number;
  currency: string;
  categoryId: string;
  categoryName: string;
  active: boolean;
}

export interface AvailabilityChangedPayload {
  menuItemId: string;
  available: boolean;
}

export type MenuItemUpdatedEvent = EventEnvelope<MenuItemUpdatedPayload>;
export type AvailabilityChangedEvent = EventEnvelope<AvailabilityChangedPayload>;

export class ContractValidationError extends Error {
  constructor(
    contract: string,
    readonly errors: string[],
  ) {
    super(`El mensaje no cumple el contrato ${contract}: ${errors.join('; ')}`);
    this.name = 'ContractValidationError';
  }
}

@Injectable()
export class ContractValidator {
  private readonly menuItemUpdated: ValidateFunction;
  private readonly availabilityChanged: ValidateFunction;

  constructor() {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    this.menuItemUpdated = ajv.compile(this.load('menu-item-updated.v1.schema.json'));
    this.availabilityChanged = ajv.compile(this.load('menu-item-availability-changed.v1.schema.json'));
  }

  validateMenuItemUpdated(value: unknown): MenuItemUpdatedEvent {
    return this.validate<MenuItemUpdatedEvent>(
      'menu-item-updated.v1.schema.json',
      this.menuItemUpdated,
      value,
    );
  }

  validateAvailabilityChanged(value: unknown): AvailabilityChangedEvent {
    return this.validate<AvailabilityChangedEvent>(
      'menu-item-availability-changed.v1.schema.json',
      this.availabilityChanged,
      value,
    );
  }

  private load(filename: string): object {
    const fromCwd = join(process.cwd(), 'contracts', filename);
    const fromModule = join(__dirname, '..', '..', 'contracts', filename);
    const path = existsSync(fromCwd) ? fromCwd : fromModule;
    return JSON.parse(readFileSync(path, 'utf8')) as object;
  }

  private validate<T>(contract: string, validator: ValidateFunction, value: unknown): T {
    if (!validator(value)) {
      const errors = (validator.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.message ?? 'inválido'}`,
      );
      throw new ContractValidationError(contract, errors);
    }
    return value as T;
  }
}
