import type { Category } from './category';
import { BusinessRuleError, ConflictError, ValidationError } from './errors';

export const DEFAULT_CURRENCY = 'MXN';
export const SUPPORTED_CURRENCIES = [DEFAULT_CURRENCY] as const;

export interface MenuItemProps {
  id: string;
  categoryId: string;
  name: string;
  japaneseName: string | null;
  description: string;
  priceCents: number;
  currency: string;
  photoPath: string | null;
  displayOrder: number;
  active: boolean;
  allergensReviewed: boolean;
  available: boolean;
  availableUpdatedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  allergens: readonly string[];
}

const NAME_MIN = 2;
const NAME_MAX = 120;

export function normalizeMenuItemName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ValidationError(`El nombre del platillo debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres`, 'RN-01');
  }
  return name;
}

export function assertPriceCents(priceCents: number): void {
  if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > 2_147_483_647) {
    throw new ValidationError('El precio debe ser un entero mayor que 0 en centavos', 'RN-02');
  }
}

export function assertCurrency(currency: string): void {
  if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
    throw new ValidationError(`La moneda soportada es ${DEFAULT_CURRENCY}`, 'RN-02');
  }
}

export class MenuItem {
  private constructor(private readonly props: MenuItemProps) {}

  static createDraft(input: {
    id: string;
    categoryId: string;
    name: string;
    japaneseName?: string | null;
    description: string;
    priceCents: number;
    displayOrder: number;
    currency?: string;
    updatedBy: string | null;
    now: Date;
  }): MenuItem {
    const name = normalizeMenuItemName(input.name);
    assertPriceCents(input.priceCents);

    const currency = input.currency ?? DEFAULT_CURRENCY;
    assertCurrency(currency);

    const description = input.description.trim();
    if (description.length === 0) {
      throw new ValidationError('La descripción es obligatoria');
    }

    const japaneseName = input.japaneseName?.trim() || null;
    if (japaneseName && japaneseName.length > 120) {
      throw new ValidationError('El nombre en japonés admite hasta 120 caracteres');
    }
    if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) {
      throw new ValidationError('El orden de aparición debe ser un entero mayor o igual a 0');
    }

    return new MenuItem({
      id: input.id,
      categoryId: input.categoryId,
      name,
      japaneseName,
      description,
      priceCents: input.priceCents,
      currency,
      photoPath: null,
      displayOrder: input.displayOrder,
      active: false,
      allergensReviewed: false,
      available: true,
      availableUpdatedAt: null,
      revision: 1,
      createdAt: input.now,
      updatedAt: input.now,
      updatedBy: input.updatedBy,
      allergens: [],
    });
  }

  static rehydrate(props: MenuItemProps): MenuItem {
    return new MenuItem({ ...props, allergens: [...props.allergens] });
  }

  get id(): string {
    return this.props.id;
  }

  get categoryId(): string {
    return this.props.categoryId;
  }

  get name(): string {
    return this.props.name;
  }

  get japaneseName(): string | null {
    return this.props.japaneseName;
  }

  get description(): string {
    return this.props.description;
  }

  get priceCents(): number {
    return this.props.priceCents;
  }

  get currency(): string {
    return this.props.currency;
  }

  get photoPath(): string | null {
    return this.props.photoPath;
  }

  get displayOrder(): number {
    return this.props.displayOrder;
  }

  get active(): boolean {
    return this.props.active;
  }

  get allergensReviewed(): boolean {
    return this.props.allergensReviewed;
  }

  get available(): boolean {
    return this.props.available;
  }

  get availableUpdatedAt(): Date | null {
    return this.props.availableUpdatedAt;
  }

  get revision(): number {
    return this.props.revision;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get updatedBy(): string | null {
    return this.props.updatedBy;
  }

  get allergens(): readonly string[] {
    return this.props.allergens;
  }

  updateDetails(
    input: {
      name?: string;
      japaneseName?: string | null;
      description?: string;
      priceCents?: number;
      categoryId?: string;
      displayOrder?: number;
    },
    now: Date,
    actorId: string | null,
  ): MenuItem {
    const name = input.name !== undefined ? normalizeMenuItemName(input.name) : this.props.name;
    const description = input.description !== undefined ? input.description.trim() : this.props.description;
    if (description.length === 0) {
      throw new ValidationError('La descripción es obligatoria');
    }

    const priceCents = input.priceCents !== undefined ? input.priceCents : this.props.priceCents;
    assertPriceCents(priceCents);

    const japaneseName =
      input.japaneseName !== undefined ? input.japaneseName?.trim() || null : this.props.japaneseName;
    if (japaneseName && japaneseName.length > 120) {
      throw new ValidationError('El nombre en japonés admite hasta 120 caracteres');
    }

    const categoryId = input.categoryId !== undefined ? input.categoryId : this.props.categoryId;
    const displayOrder = input.displayOrder !== undefined ? input.displayOrder : this.props.displayOrder;
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      throw new ValidationError('El orden de aparición debe ser un entero mayor o igual a 0');
    }

    const publishableChange =
      name !== this.props.name || priceCents !== this.props.priceCents || categoryId !== this.props.categoryId;
    const anyChange =
      publishableChange ||
      description !== this.props.description ||
      japaneseName !== this.props.japaneseName ||
      displayOrder !== this.props.displayOrder;

    if (!anyChange) {
      return this;
    }

    return this.next({
      name,
      description,
      priceCents,
      japaneseName,
      categoryId,
      displayOrder,
      revision: publishableChange ? this.props.revision + 1 : this.props.revision,
      updatedAt: now,
      updatedBy: actorId,
    });
  }

  withPhoto(photoPath: string | null, now: Date, actorId: string | null): MenuItem {
    return this.next({ photoPath, updatedAt: now, updatedBy: actorId });
  }

  isAvailabilityStale(occurredAt: Date): boolean {
    return this.props.availableUpdatedAt !== null && occurredAt.getTime() <= this.props.availableUpdatedAt.getTime();
  }

  applyAvailability(available: boolean, occurredAt: Date): MenuItem {
    if (this.isAvailabilityStale(occurredAt)) {
      return this;
    }
    return this.next({ available, availableUpdatedAt: occurredAt });
  }

  bumpRevision(now: Date, actorId: string | null): MenuItem {
    return this.next({ revision: this.props.revision + 1, updatedAt: now, updatedBy: actorId });
  }

  assertRevision(revision: number): void {
    if (revision !== this.props.revision) {
      throw new ConflictError(
        `La revisión enviada (${revision}) no coincide con la actual (${this.props.revision})`,
        'RN-08',
      );
    }
  }

  replaceAllergens(codes: readonly string[], now: Date, actorId: string | null): MenuItem {
    return this.next({ allergens: [...codes], allergensReviewed: true, updatedAt: now, updatedBy: actorId });
  }

  activate(category: Category, now: Date, actorId: string | null): MenuItem {
    if (!this.props.allergensReviewed) {
      throw new BusinessRuleError(
        'No se puede activar un platillo sin revisar sus alérgenos (RN-03)',
        'RN-03',
      );
    }
    if (!category.active) {
      throw new BusinessRuleError('No se puede activar un platillo de una categoría inactiva (RN-06)', 'RN-06');
    }
    if (this.props.active) {
      return this;
    }
    return this.next({
      active: true,
      revision: this.props.revision + 1,
      updatedAt: now,
      updatedBy: actorId,
    });
  }

  deactivate(now: Date, actorId: string | null): MenuItem {
    if (!this.props.active) {
      return this;
    }
    return this.next({
      active: false,
      revision: this.props.revision + 1,
      updatedAt: now,
      updatedBy: actorId,
    });
  }

  private next(partial: Partial<MenuItemProps>): MenuItem {
    return new MenuItem({ ...this.props, ...partial });
  }
}
