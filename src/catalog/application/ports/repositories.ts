import type { Category } from '../../domain/category';
import type { MenuItem } from '../../domain/menu-item';

export interface Allergen {
  code: string;
  name: string;
}

export interface AdminMenuItemView {
  item: MenuItem;
  categoryName: string;
}

export interface PublicMenuCategoryView {
  category: Category;
  items: MenuItem[];
}

export interface CategoryRepository {
  create(category: Category): Promise<void>;
  findById(id: string): Promise<Category | null>;
  findByNameInsensitive(name: string): Promise<Category | null>;
  listActive(): Promise<Category[]>;
  listAll(): Promise<Category[]>;
}

export interface MenuItemRepository {
  create(item: MenuItem): Promise<void>;
  findById(id: string): Promise<MenuItem | null>;
  existsByNameInCategory(categoryId: string, name: string, excludeId?: string): Promise<boolean>;
  update(item: MenuItem): Promise<void>;
  replaceAllergens(itemId: string, codes: readonly string[], actorId: string | null, now: Date): Promise<void>;
  listAdmin(page: number, size: number): Promise<{ items: AdminMenuItemView[]; total: number }>;
  listPublicMenu(): Promise<PublicMenuCategoryView[]>;
}

export interface AllergenRepository {
  list(): Promise<Allergen[]>;
  existingCodes(codes: readonly string[]): Promise<Set<string>>;
}

export interface NewOutboxEvent {
  id: string;
  type: string;
  routingKey: string;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  version: number;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

export interface OutboxRepository {
  append(event: NewOutboxEvent): Promise<void>;
}

export interface TransactionRepositories {
  categories: CategoryRepository;
  items: MenuItemRepository;
  allergens: AllergenRepository;
  outbox: OutboxRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: TransactionRepositories) => Promise<T>): Promise<T>;
}
