import { Category, type CategoryProps } from './category';
import { BusinessRuleError, ConflictError, ValidationError } from './errors';
import { MenuItem } from './menu-item';

const NOW = new Date('2026-10-20T18:42:10.000Z');

function category(overrides: Partial<CategoryProps> = {}): Category {
  return Category.rehydrate({
    id: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
    name: 'Nigiri',
    slug: 'nigiri',
    displayOrder: 20,
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function draft(): MenuItem {
  return MenuItem.createDraft({
    id: '3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10',
    categoryId: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
    name: '  Nigiri   de salmón ',
    japaneseName: 'サーモン握り',
    description: 'Salmón fresco sobre arroz de sushi.',
    priceCents: 18900,
    displayOrder: 10,
    updatedBy: null,
    now: NOW,
  });
}

describe('MenuItem (RN-01, RN-02, RN-03, RN-05, RN-07, RN-08)', () => {
  it('crea un borrador con los valores por defecto', () => {
    const item = draft();

    expect(item.name).toBe('Nigiri de salmón');
    expect(item.active).toBe(false);
    expect(item.available).toBe(true);
    expect(item.allergensReviewed).toBe(false);
    expect(item.revision).toBe(1);
    expect(item.currency).toBe('MXN');
    expect(item.allergens).toEqual([]);
  });

  it('rechaza nombres fuera de rango y precios no positivos', () => {
    expect(() =>
      MenuItem.createDraft({
        id: 'id',
        categoryId: 'category',
        name: 'x',
        description: 'desc',
        priceCents: 100,
        displayOrder: 0,
        updatedBy: null,
        now: NOW,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      MenuItem.createDraft({
        id: 'id',
        categoryId: 'category',
        name: 'Platillo',
        description: 'desc',
        priceCents: 0,
        displayOrder: 0,
        updatedBy: null,
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  it('no permite activar sin alérgenos revisados (RN-03)', () => {
    expect(() => draft().activate(category(), NOW, 'actor')).toThrow(BusinessRuleError);
  });

  it('no permite activar en una categoría inactiva (RN-06)', () => {
    const reviewed = draft().replaceAllergens(['pescado'], NOW, 'actor');
    expect(() => reviewed.activate(category({ active: false }), NOW, 'actor')).toThrow(BusinessRuleError);
  });

  it('revisar alérgenos no cambia la revisión ni requiere evento (RN-09)', () => {
    const reviewed = draft().replaceAllergens(['pescado', 'soya'], NOW, 'actor');

    expect(reviewed.allergensReviewed).toBe(true);
    expect(reviewed.allergens).toEqual(['pescado', 'soya']);
    expect(reviewed.revision).toBe(1);
  });

  it('activar sube la revisión y desactivar también (RN-07)', () => {
    const reviewed = draft().replaceAllergens(['pescado'], NOW, 'actor');
    const active = reviewed.activate(category(), NOW, 'actor');
    const inactive = active.deactivate(NOW, 'actor');

    expect(active.active).toBe(true);
    expect(active.revision).toBe(2);
    expect(inactive.active).toBe(false);
    expect(inactive.revision).toBe(3);
  });

  it('activar dos veces es idempotente y no sube la revisión', () => {
    const reviewed = draft().replaceAllergens(['pescado'], NOW, 'actor');
    const active = reviewed.activate(category(), NOW, 'actor');
    const again = active.activate(category(), NOW, 'actor');

    expect(again.revision).toBe(2);
  });

  it('rechaza una revisión desactualizada (RN-08)', () => {
    expect(() => draft().assertRevision(2)).toThrow(ConflictError);
    expect(() => draft().assertRevision(1)).not.toThrow();
  });
});
