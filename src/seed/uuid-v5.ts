import { createHash } from 'node:crypto';

const NAMESPACE = 'f3f1a7d2-6e2b-4a6f-9f2a-1c3b5d7e9a01';

export const SEED_NAMESPACE = NAMESPACE;

/**
 * UUID v5 (SHA-1) para que los datos semilla tengan IDs reproducibles entre
 * entornos. Inventory reutiliza estos IDs en la etapa A.
 */
export function uuidV5(name: string): string {
  const namespace = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(namespace).update(Buffer.from(name, 'utf8')).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
