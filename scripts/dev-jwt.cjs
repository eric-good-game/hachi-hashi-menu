#!/usr/bin/env node
'use strict';

/**
 * Simulador de Identity para el Hito 3. Genera un par de claves RSA (si no
 * existen) y firma un JWT RS256 con la forma esperada por el guard.
 *
 * Uso:
 *   node scripts/dev-jwt.cjs [opciones]
 *
 * Opciones:
 *   --key-dir <dir>       Directorio de claves (por defecto var/dev-identity).
 *   --sub <subject>       Claim `sub` (por defecto dev-admin-1).
 *   --roles a,b           Roles en el claim `roles` (por defecto admin).
 *   --realm               Anida los roles en `realm_access.roles`.
 *   --expires-in <tiempo> Vigencia según jsonwebtoken (por defecto 1h).
 *   --expired             Emite un token ya vencido (para probar 401).
 *   --wrong-key           Firma con una clave distinta a la pública expuesta.
 *   --quiet               Imprime solo el token.
 *
 * Ejemplo:
 *   node scripts/dev-jwt.cjs --roles admin --expires-in 30m
 *   AUTH_MODE=jwt JWT_PUBLIC_KEY_FILE=var/dev-identity/public.pem pnpm start:dev
 */

const { generateKeyPairSync } = require('node:crypto');
const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const jwt = require('jsonwebtoken');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Argumento inesperado: ${token}`);
    }
    const [name, inlineValue] = token.slice(2).split('=');
    if (name === 'realm' || name === 'expired' || name === 'wrong-key' || name === 'quiet') {
      args[name] = true;
      continue;
    }
    const value = inlineValue !== undefined ? inlineValue : argv[index + 1];
    if (value === undefined || (inlineValue === undefined && value.startsWith('--'))) {
      throw new Error(`Falta el valor de --${name}`);
    }
    args[name] = value;
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  return args;
}

function generatePair() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

function loadOrCreateKeys(keyDir) {
  const privatePath = join(keyDir, 'private.pem');
  const publicPath = join(keyDir, 'public.pem');

  if (existsSync(privatePath) && existsSync(publicPath)) {
    return {
      privateKey: readFileSync(privatePath, 'utf8'),
      publicKey: readFileSync(publicPath, 'utf8'),
      privatePath,
      publicPath,
    };
  }

  const pair = generatePair();
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(privatePath, pair.privateKey, { mode: 0o600 });
  writeFileSync(publicPath, pair.publicKey, { mode: 0o644 });
  chmodSync(privatePath, 0o600);
  return { ...pair, privatePath, publicPath };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const keyDir = resolve(args['key-dir'] || join('var', 'dev-identity'));
  const keys = loadOrCreateKeys(keyDir);

  const sub = args.sub || 'dev-admin-1';
  const roles = (args.roles || 'admin')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
  if (roles.length === 0) {
    throw new Error('--roles no puede quedar vacío');
  }

  const payload = { sub };
  if (args.realm) {
    payload.realm_access = { roles };
  } else {
    payload.roles = roles;
  }

  const signingKey = args['wrong-key'] ? generatePair().privateKey : keys.privateKey;
  const expiresIn = args.expired ? -10 : args['expires-in'] || '1h';
  const token = jwt.sign(payload, signingKey, { algorithm: 'RS256', expiresIn });

  if (args.quiet) {
    process.stdout.write(`${token}\n`);
    return;
  }

  process.stdout.write(
    [
      `Clave pública:  ${keys.publicPath}`,
      `Clave privada:  ${keys.privatePath}`,
      `sub:            ${sub}`,
      `roles:          ${roles.join(', ')}${args.realm ? ' (realm_access.roles)' : ''}`,
      `expira:         ${args.expired ? 'vencido' : expiresIn}`,
      `firma:          ${args['wrong-key'] ? 'clave ajena (token inválido)' : 'clave local'}`,
      '',
      'Variables para el servicio:',
      `  AUTH_MODE=jwt JWT_PUBLIC_KEY_FILE=${keys.publicPath} pnpm start:dev`,
      '',
      'Token:',
      token,
      '',
    ].join('\n'),
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
