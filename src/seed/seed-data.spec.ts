import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLERGEN_SEED, CATEGORY_SEED } from './seed-data';
import { MENU_ITEM_SEED } from './menu-item-seed';
import { uuidV5 } from './uuid-v5';

describe('semilla de platillos', () => {
  it('contiene 30 platillos con slugs y nombres únicos', () => {
    expect(MENU_ITEM_SEED).toHaveLength(30);
    expect(new Set(MENU_ITEM_SEED.map((item) => item.slug)).size).toBe(MENU_ITEM_SEED.length);
    expect(new Set(MENU_ITEM_SEED.map((item) => item.name)).size).toBe(MENU_ITEM_SEED.length);
  });

  it('referencia categorías y alérgenos existentes', () => {
    const categorySlugs = new Set<string>(CATEGORY_SEED.map((category) => category.slug));
    const allergenCodes = new Set<string>(ALLERGEN_SEED.map((allergen) => allergen.code));

    for (const item of MENU_ITEM_SEED) {
      expect(categorySlugs.has(item.categorySlug)).toBe(true);
      expect(Number.isInteger(item.priceCents) && item.priceCents > 0).toBe(true);
      for (const code of item.allergens) {
        expect(allergenCodes.has(code)).toBe(true);
      }
    }
  });

  it('publica IDs deterministas que coinciden con contracts/seed/menu-item-ids.json', () => {
    const document = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts', 'seed', 'menu-item-ids.json'), 'utf8'),
    ) as { items: Array<{ id: string; slug: string; name: string; categorySlug: string }> };

    const expected = MENU_ITEM_SEED.map((seed) => ({
      id: uuidV5(`menu-item:${seed.slug}`),
      slug: seed.slug,
      name: seed.name,
      categorySlug: seed.categorySlug,
    }));

    expect(document.items).toEqual(expected);
  });
});
