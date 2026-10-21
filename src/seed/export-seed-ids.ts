import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MENU_ITEM_SEED } from './menu-item-seed';
import { SEED_NAMESPACE, uuidV5 } from './uuid-v5';

const output = join(process.cwd(), 'contracts', 'seed', 'menu-item-ids.json');

const document = {
  description:
    'IDs deterministas de los platillos semilla. Inventory puede reutilizarlos en la etapa A sin depender de Menu.',
  namespace: SEED_NAMESPACE,
  items: MENU_ITEM_SEED.map((seed) => ({
    id: uuidV5(`menu-item:${seed.slug}`),
    slug: seed.slug,
    name: seed.name,
    categorySlug: seed.categorySlug,
  })),
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Escritos ${document.items.length} IDs en ${output}`);
