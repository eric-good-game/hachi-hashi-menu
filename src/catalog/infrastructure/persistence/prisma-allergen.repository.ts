import type { Allergen, AllergenRepository } from '../../application/ports/repositories';
import type { Db } from './prisma.mappers';

export class PrismaAllergenRepository implements AllergenRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<Allergen[]> {
    return this.db.allergen.findMany({ orderBy: { code: 'asc' } });
  }

  async existingCodes(codes: readonly string[]): Promise<Set<string>> {
    if (codes.length === 0) {
      return new Set();
    }
    const rows = await this.db.allergen.findMany({
      where: { code: { in: [...codes] } },
      select: { code: true },
    });
    return new Set(rows.map((row) => row.code));
  }
}
