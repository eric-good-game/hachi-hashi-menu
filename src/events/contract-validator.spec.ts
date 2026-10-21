import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractValidationError, ContractValidator } from './contract-validator';

function example(filename: string): unknown {
  const content = readFileSync(join(process.cwd(), 'contracts', filename), 'utf8');
  return JSON.parse(content) as unknown;
}

describe('ContractValidator', () => {
  const validator = new ContractValidator();

  it('acepta el ejemplo de MenuItemUpdated', () => {
    const [event] = example('menu-item-updated.v1.examples.json') as unknown[];

    expect(validator.validateMenuItemUpdated(event).payload.revision).toBe(4);
  });

  it('acepta el ejemplo de MenuItemAvailabilityChanged', () => {
    const [event] = example('menu-item-availability-changed.v1.examples.json') as unknown[];

    const validated = validator.validateAvailabilityChanged(event);
    expect(validated.source).toBe('inventory');
    expect(validated.payload.available).toBe(false);
  });

  it('rechaza un evento publicado con campos faltantes', () => {
    const [event] = example('menu-item-updated.v1.examples.json') as Array<Record<string, unknown>>;
    const invalid = { ...event, payload: { ...(event.payload as object), name: undefined } };

    expect(() => validator.validateMenuItemUpdated(invalid)).toThrow(ContractValidationError);
  });

  it('rechaza una disponibilidad con un tipo de evento distinto', () => {
    const [event] = example('menu-item-availability-changed.v1.examples.json') as Array<Record<string, unknown>>;

    expect(() =>
      validator.validateAvailabilityChanged({ ...event, type: 'MenuItemUpdated' }),
    ).toThrow(ContractValidationError);
  });
});
