import type { Category } from '../domain/category';
import type { AdminMenuItemView } from '../application/ports/repositories';

export interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  active: boolean;
}

export interface AdminMenuItemResponse {
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
  displayOrder: number;
  active: boolean;
  allergensReviewed: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function toCategoryResponse(category: Category): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    displayOrder: category.displayOrder,
    active: category.active,
  };
}

export function toAdminMenuItemResponse(view: AdminMenuItemView, publicBaseUrl: string): AdminMenuItemResponse {
  const { item } = view;
  const baseUrl = publicBaseUrl.replace(/\/+$/, '');

  return {
    id: item.id,
    name: item.name,
    japaneseName: item.japaneseName,
    description: item.description,
    priceCents: item.priceCents,
    currency: item.currency,
    category: { id: item.categoryId, name: view.categoryName },
    allergens: [...item.allergens],
    photoUrl: item.photoPath ? `${baseUrl}/api/menu/media/${encodeURIComponent(item.photoPath)}` : null,
    available: item.available,
    displayOrder: item.displayOrder,
    active: item.active,
    allergensReviewed: item.allergensReviewed,
    revision: item.revision,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
