import { generateKeyPairSync } from 'node:crypto';
import { sign, type SignOptions } from 'jsonwebtoken';

export interface JwtKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateJwtKeyPair(): JwtKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return { privateKey, publicKey };
}

export function signJwt(
  privateKey: string,
  payload: Record<string, unknown>,
  options: SignOptions = {},
): string {
  return sign(payload, privateKey, { algorithm: 'RS256', ...options });
}
