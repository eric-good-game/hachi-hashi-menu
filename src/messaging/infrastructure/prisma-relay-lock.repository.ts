import { Prisma, type PrismaClient } from '@prisma/client';
import type { RelayLockPort } from '../application/ports/relay-lock';

/** Subconjunto de Prisma que necesita el lease (acepta `PrismaClient` o `PrismaService`). */
export type SqlExecutor = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/**
 * Lease del relay del Outbox sobre la tabla `relay_lock` (D-48).
 *
 * Adquirir y renovar es un único upsert atómico: inserta la fila si no existe y,
 * si existe, la actualiza solo cuando ya es nuestra o cuando expiró. Así dos
 * instancias concurrentes nunca la obtienen a la vez, sin necesidad de una
 * transacción interactiva ni de un advisory lock atado a una conexión del pool.
 */
export class PrismaRelayLockRepository implements RelayLockPort {
  constructor(private readonly db: SqlExecutor) {}

  async acquire(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const ttl = `${ttlMs} milliseconds`;
    const rows = await this.db.$queryRaw<Array<{ holder: string }>>(Prisma.sql`
      INSERT INTO "relay_lock" ("name", "holder", "expires_at", "updated_at")
      VALUES (${name}, ${holder}, now() + (${ttl}::text)::interval, now())
      ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder",
          "expires_at" = EXCLUDED."expires_at",
          "updated_at" = now()
      WHERE "relay_lock"."holder" = EXCLUDED."holder"
         OR "relay_lock"."expires_at" < now()
      RETURNING "holder"
    `);

    return rows.length > 0;
  }

  async release(name: string, holder: string): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE "relay_lock"
      SET "expires_at" = now(), "updated_at" = now()
      WHERE "name" = ${name} AND "holder" = ${holder}
    `);
  }
}
