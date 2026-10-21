#!/usr/bin/env node
'use strict';

/**
 * Simulador de Inventory para el Hito 3. Publica sobres
 * MenuItemAvailabilityChanged en `hachi.events` para probar el consumidor real
 * sin depender del servicio Inventory (todavía no existe).
 *
 * Uso:
 *   node scripts/dev-inventory-publisher.cjs --menu-item-id <uuid> [opciones]
 *
 * Opciones:
 *   --menu-item-id <uuid>    Obligatorio. Platillo destino.
 *   --available <true|false> Disponibilidad a publicar (por defecto: false).
 *   --occurred-at <iso>      Fecha del evento (por defecto: ahora).
 *   --message-id <uuid>      messageId fijo; con --repeat se reutiliza.
 *   --correlation-id <uuid>  correlationId del sobre.
 *   --url <amqp-url>         Broker (por defecto RABBITMQ_URL o localhost).
 *   --routing-key <key>      Routing key (por defecto la de disponibilidad).
 *   --invalid                Publica un tipo inválido para ejercitar la DLQ.
 *   --repeat <n>             Publica n copias (por defecto 1).
 */

const { randomUUID } = require('node:crypto');
const amqp = require('amqplib');

const DEFAULT_URL = process.env.RABBITMQ_URL || 'amqp://menu:menu@localhost:5672';
const EVENTS_EXCHANGE = 'hachi.events';
const AVAILABILITY_ROUTING_KEY = 'inventory.menu-item-availability-changed';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Argumento inesperado: ${token}`);
    }
    const [rawName, inlineValue] = token.slice(2).split('=');
    const name = rawName;
    if (inlineValue !== undefined) {
      args[name] = inlineValue;
      continue;
    }
    if (name === 'invalid') {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Falta el valor de --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function requireUuid(value, label) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} debe ser un UUID: ${value}`);
  }
}

function buildEnvelope(args) {
  const available = args.available === undefined ? false : args.available === 'true';
  if (args.available !== undefined && args.available !== 'true' && args.available !== 'false') {
    throw new Error(`--available debe ser true o false, recibí ${args.available}`);
  }

  return {
    messageId: args['message-id'] || randomUUID(),
    type: args.invalid ? 'EventoDesconocido' : 'MenuItemAvailabilityChanged',
    version: 1,
    occurredAt: args['occurred-at'] || new Date().toISOString(),
    source: 'inventory',
    correlationId: args['correlation-id'] || randomUUID(),
    causationId: null,
    payload: {
      menuItemId: args['menu-item-id'],
      available,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['menu-item-id']) {
    throw new Error('Falta --menu-item-id');
  }
  requireUuid(args['menu-item-id'], '--menu-item-id');
  if (args['message-id']) {
    requireUuid(args['message-id'], '--message-id');
  }
  if (args['correlation-id']) {
    requireUuid(args['correlation-id'], '--correlation-id');
  }

  const repeat = args.repeat === undefined ? 1 : Number(args.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error('--repeat debe ser un entero mayor o igual a 1');
  }

  const url = args.url || DEFAULT_URL;
  const routingKey = args['routing-key'] || AVAILABILITY_ROUTING_KEY;

  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  connection.on('error', () => undefined);
  channel.on('error', () => undefined);

  await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });

  const published = [];
  for (let index = 0; index < repeat; index += 1) {
    const envelope = buildEnvelope(args);
    channel.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(envelope), 'utf8'), {
      persistent: true,
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      messageId: envelope.messageId,
      type: envelope.type,
      correlationId: envelope.correlationId,
      timestamp: Math.floor(Date.now() / 1000),
      appId: 'inventory-simulator',
    });
    published.push(envelope.messageId);
  }

  await channel.waitForConfirms();
  await channel.close();
  await connection.close();

  process.stdout.write(
    `${JSON.stringify(
      {
        exchange: EVENTS_EXCHANGE,
        routingKey,
        type: args.invalid ? 'EventoDesconocido' : 'MenuItemAvailabilityChanged',
        menuItemId: args['menu-item-id'],
        messageIds: published,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
