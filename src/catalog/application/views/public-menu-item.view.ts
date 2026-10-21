import type { MenuItem } from '../../domain/menu-item';

export interface PublicMenuItemResponse {
  id: string;
  name: string;
  japaneseName: string | null;
  description: string;
  priceCents: number;
  currency: string;
  category: { id: string; name: string };
  allergens: string[];
  photoUrl: string | null;
  available: boolean;
}

export function toPublicMenuItemResponse(
  item: MenuItem,
  category: { id: string; name: string },
  publicBaseUrl: string,
): PublicMenuItemResponse {
  const baseUrl = publicBaseUrl.replace(/\/+$/, '');

  return {
    id: item.id,
    name: item.name,
    japaneseName: item.japaneseName,
    description: item.description,
    priceCents: item.priceCents,
    currency: item.currency,
    category: { id: category.id, name: category.name },
    allergens: [...item.allergens],
    photoUrl: item.photoPath ? `${baseUrl}/api/menu/media/${encodeURIComponent(item.photoPath)}` : null,
    available: item.available,
  };
}
