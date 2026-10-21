import slugify from 'slugify';
import { ValidationError } from './errors';

export interface CategoryProps {
  id: string;
  name: string;
  slug: string;
  displayOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NAME_MIN = 2;
const NAME_MAX = 80;
const SLUG_MAX = 80;

export function normalizeCategoryName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw new ValidationError(`El nombre de la categoría debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres`, 'RN-01');
  }
  return name;
}

export function normalizeCategorySlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > SLUG_MAX) {
    throw new ValidationError(
      'El slug debe usar minúsculas, números y guiones, con un máximo de 80 caracteres',
      'INVALID_SLUG',
    );
  }
  return slug;
}

export function categorySlugFromName(name: string, fallbackId: string): string {
  const generated = slugify(name, { lower: true, strict: true, trim: true, locale: 'es' }).slice(0, SLUG_MAX);
  return generated.length > 0 ? generated : `categoria-${fallbackId.slice(0, 8)}`;
}

export class Category {
  private constructor(private readonly props: CategoryProps) {}

  static create(input: {
    id: string;
    name: string;
    slug: string;
    displayOrder: number;
    now: Date;
  }): Category {
    const name = normalizeCategoryName(input.name);
    const slug = normalizeCategorySlug(input.slug);

    if (!Number.isInteger(input.displayOrder) || input.displayOrder < 0) {
      throw new ValidationError('El orden de aparición debe ser un entero mayor o igual a 0');
    }

    return new Category({
      id: input.id,
      name,
      slug,
      displayOrder: input.displayOrder,
      active: true,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: CategoryProps): Category {
    return new Category({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
  }

  get displayOrder(): number {
    return this.props.displayOrder;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  updateDetails(input: { name?: string; displayOrder?: number }, now: Date): Category {
    const name = input.name !== undefined ? normalizeCategoryName(input.name) : this.props.name;
    const displayOrder = input.displayOrder !== undefined ? input.displayOrder : this.props.displayOrder;

    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      throw new ValidationError('El orden de aparición debe ser un entero mayor o igual a 0');
    }

    if (name === this.props.name && displayOrder === this.props.displayOrder) {
      return this;
    }

    return new Category({
      ...this.props,
      name,
      displayOrder,
      updatedAt: now,
    });
  }

  withStatus(active: boolean, now: Date): Category {
    if (active === this.props.active) {
      return this;
    }
    return new Category({ ...this.props, active, updatedAt: now });
  }
}
