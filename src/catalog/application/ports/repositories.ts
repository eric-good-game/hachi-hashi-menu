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

export type PublicMenuItemView = AdminMenuItemView;

export interface PublicMenuCategoryView {
  category: Category;
  items: MenuItem[];
}

export interface PublicItemsFilter {
  categoryId?: string;
  available?: boolean;
  excludeAllergens: string[];
  q?: string;
  page: number;
  size: number;
}

export interface PaginatedItems {
  items: PublicMenuItemView[];
  total: number;
}

export interface CategoryRepository {
  create(category: Category): Promise<void>;
  update(category: Category): Promise<void>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Category | null>;
  findByNameInsensitive(name: string): Promise<Category | null>;
  listActive(): Promise<Category[]>;
  listAll(): Promise<Category[]>;
}

export interface MenuItemRepository {
  create(item: MenuItem): Promise<void>;
  findById(id: string): Promise<MenuItem | null>;
  findPublicById(id: string): Promise<PublicMenuItemView | null>;
  existsByNameInCategory(categoryId: string, name: string, excludeId?: string): Promise<boolean>;
  update(item: MenuItem): Promise<void>;
  updateDetails(item: MenuItem): Promise<void>;
  updatePhoto(itemId: string, photoPath: string | null, actorId: string | null, now: Date): Promise<void>;
  replaceAllergens(itemId: string, codes: readonly string[], actorId: string | null, now: Date): Promise<void>;
  updateAvailability(itemId: string, available: boolean, occurredAt: Date): Promise<boolean>;
  listByCategoryId(categoryId: string): Promise<MenuItem[]>;
  countByCategory(categoryId: string): Promise<number>;
  countActiveByCategory(categoryId: string): Promise<number>;
  listAdmin(page: number, size: number): Promise<{ items: AdminMenuItemView[]; total: number }>;
  listPublicMenu(): Promise<PublicMenuCategoryView[]>;
  listPublicItems(filter: PublicItemsFilter): Promise<PaginatedItems>;
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

export interface OutboxRecord extends NewOutboxEvent {
  seq: bigint;
  attempts: number;
  lastError: string | null;
}

export interface OutboxRepository {
  append(event: NewOutboxEvent): Promise<void>;
  listUnpublished(limit: number): Promise<OutboxRecord[]>;
  markPublished(seq: bigint, publishedAt: Date): Promise<void>;
  recordFailure(seq: bigint, error: string): Promise<void>;
}

export interface ProcessedMessageRepository {
  exists(messageId: string): Promise<boolean>;
  markProcessed(messageId: string, consumer: string, processedAt: Date): Promise<void>;
}

export interface TransactionRepositories {
  categories: CategoryRepository;
  items: MenuItemRepository;
  allergens: AllergenRepository;
  outbox: OutboxRepository;
  processedMessages: ProcessedMessageRepository;
}

export interface UnitOfWork {
  run<T>(work: (repositories: TransactionRepositories) => Promise<T>): Promise<T>;
}
