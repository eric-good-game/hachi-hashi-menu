import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import type { AppEnv } from '../../config/env.schema';
import type { AuthenticatedUser } from './auth.types';
import { extractRoles, JwtAuthGuard } from './jwt-auth.guard';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const USER_ID = '00000000-0000-4000-8000-000000000001';

function contextFor(authorization?: string): {
  context: ExecutionContext;
  request: { user?: AuthenticatedUser };
} {
  const request: { user?: AuthenticatedUser; header: (name: string) => string | undefined } = {
    header: (name) => (name === 'authorization' ? authorization : undefined),
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function buildGuard(): JwtAuthGuard {
  return new JwtAuthGuard({ AUTH_MODE: 'jwt' } as AppEnv, {
    getPublicKey: async () => publicKey,
  });
}

describe('JwtAuthGuard', () => {
  it('valida RS256 y expone sub y roles', async () => {
    const token = sign({ sub: USER_ID, roles: ['admin', 'viewer'] }, privateKey, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });
    const { context, request } = contextFor(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ sub: USER_ID, roles: ['admin', 'viewer'] });
  });

  it('acepta roles de realm_access (Keycloak)', async () => {
    const token = sign(
      { sub: USER_ID, realm_access: { roles: ['admin'] } },
      privateKey,
      { algorithm: 'RS256', expiresIn: '5m' },
    );
    const { context, request } = contextFor(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).resolves.toBe(true);
    expect(request.user?.roles).toEqual(['admin']);
  });

  it('rechaza un token ausente', async () => {
    const { context } = contextFor();

    await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token expirado', async () => {
    const token = sign({ sub: USER_ID, roles: ['admin'] }, privateKey, {
      algorithm: 'RS256',
      expiresIn: -10,
    });
    const { context } = contextFor(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token firmado con otra clave', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = sign({ sub: USER_ID, roles: ['admin'] }, other.privateKey, {
      algorithm: 'RS256',
      expiresIn: '5m',
    });
    const { context } = contextFor(`Bearer ${token}`);

    await expect(buildGuard().canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('extrae roles sin duplicar ni aceptar valores no string', () => {
    expect(extractRoles({ roles: ['admin', 1, 'viewer'] })).toEqual(['admin', 'viewer']);
    expect(extractRoles({ realm_access: { roles: ['admin'] } })).toEqual(['admin']);
    expect(extractRoles({})).toEqual([]);
  });
});
