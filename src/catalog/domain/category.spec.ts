import { Category, categorySlugFromName } from './category';

const NOW = new Date('2026-10-20T18:42:10.000Z');
const LATER = new Date('2026-10-20T19:00:00.000Z');

function category(): Category {
  return Category.create({
    id: 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10',
    name: 'Nigiri',
    slug: categorySlugFromName('Nigiri', 'b2d4e6f8-1a3c-4e5b-9d7f-0c2a4e6b8d10'),
    displayOrder: 20,
    now: NOW,
  });
}

describe('Category', () => {
  it('normaliza el nombre y genera el slug', () => {
    const created = category();

    expect(created.name).toBe('Nigiri');
    expect(created.slug).toBe('nigiri');
    expect(created.active).toBe(true);
  });

  it('edita nombre y orden sin cambiar el slug (D-07)', () => {
    const updated = category().updateDetails({ name: 'Nigiri premium', displayOrder: 25 }, LATER);

    expect(updated.name).toBe('Nigiri premium');
    expect(updated.slug).toBe('nigiri');
    expect(updated.displayOrder).toBe(25);
    expect(updated.updatedAt).toEqual(LATER);
  });

  it('devuelve la misma instancia si no hay cambios', () => {
    const original = category();
    expect(original.updateDetails({ name: 'Nigiri', displayOrder: 20 }, LATER)).toBe(original);
  });

  it('cambia el estado sin tocar el slug', () => {
    const inactive = category().withStatus(false, LATER);

    expect(inactive.active).toBe(false);
    expect(inactive.slug).toBe('nigiri');
    expect(inactive.updatedAt).toEqual(LATER);
  });
});
