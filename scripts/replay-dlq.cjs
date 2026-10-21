#!/usr/bin/env node
'use strict';

/**
 * Reprograma mensajes de la DLQ de disponibilidad de vuelta al intercambio de
 * eventos para que el consumidor los reintente (D-50).
 *
 * Uso:
 *   node scripts/replay-dlq.cjs [opciones]
 *
 * Opciones:
 *   --url <amqp-url>        Broker (por defecto RABBITMQ_URL o localhost).
 *   --queue <name>          Cola origen (por defecto la DLQ de disponibilidad).
 *   --exchange <name>       Intercambio destino (por defecto `hachi.events`).
 *   --routing-key <key>     Fuerza la routing key; por defecto se toma de
 *                           `x-death` y, si no está, la de disponibilidad.
 *   --limit <n>             Máximo de mensajes a reprocesar (por defecto 100).
 *   --dry-run               Inspecciona sin publicar ni confirmar.
 *   --keep-retry-count      No reinicia `x-retry-count` al reprogramar.
 *
 * El `messageId` original se conserva a propósito: el consumidor es idempotente
 * y así un mensaje ya aplicado no se vuelve a aplicar.
 */

const amqp = require('amqplib');

const DEFAULT_URL = process.env.RABBITMQ_URL || 'amqp://menu:menu@localhost:5672';
const EVENTS_EXCHANGE = 'hachi.events';
const AVAILABILITY_DLQ = 'menu.inventory-events.dlq';
const AVAILABILITY_ROUTING_KEY = 'inventory.menu-item-availability-changed';
const REPLAYED_BY = 'menu-dlq-replay';

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
    if (name === 'dry-run' || name === 'keep-retry-count') {
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

/** La routing key original del mensaje quedó registrada en `x-death`. */
function originalRoutingKey(message, fallback) {
  const death = message.properties.headers?.['x-death'];
  if (Array.isArray(death)) {
    for (const entry of death) {
      const keys = entry?.['routing-keys'];
      if (Array.isArray(keys) && typeof keys[0] === 'string') {
        return keys[0];
      }
    }
  }
  return fallback;
}

function replayedHeaders(message, keepRetryCount) {
  const headers = { ...(message.properties.headers ?? {}) };
  headers['x-replayed-at'] = new Date().toISOString();
  headers['x-replayed-by'] = REPLAYED_BY;
  if (!keepRetryCount) {
    // Reintento con presupuesto completo: si no se reinicia, el consumidor lo
    // devolvería a la DLQ sin intentarlo.
    headers['x-retry-count'] = 0;
  }
  return headers;
}

async function collect(channel, queue, limit, timeoutMs = 10_000) {
  const messages = [];
  let consumerTag = null;

  await channel.prefetch(limit);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Si la cola se vació por otra vía, no nos quedamos colgados.
      resolve();
    }, timeoutMs);

    channel
      .consume(
        queue,
        (message) => {
          if (!message) {
            return;
          }
          messages.push(message);
          if (messages.length >= limit) {
            clearTimeout(timer);
            resolve();
          }
        },
        { noAck: false },
      )
      .then(({ consumerTag: tag }) => {
        consumerTag = tag;
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

  if (consumerTag) {
    await channel.cancel(consumerTag).catch(() => undefined);
  }
  return messages;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || DEFAULT_URL;
  const queue = args.queue || AVAILABILITY_DLQ;
  const exchange = args.exchange || EVENTS_EXCHANGE;
  const dryRun = args['dry-run'] === true;
  const limit = args.limit === undefined ? 100 : Number(args.limit);

  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error('--limit debe ser un entero mayor o igual a 0');
  }

  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  connection.on('error', () => undefined);
  channel.on('error', () => undefined);

  await channel.assertExchange(exchange, 'topic', { durable: true });

  const before = await channel.checkQueue(queue);
  if (before.messageCount === 0 || limit === 0) {
    await channel.close();
    await connection.close();
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: dryRun ? 'dry-run' : 'replay',
          queue,
          exchange,
          available: before.messageCount,
          replayed: 0,
          remaining: before.messageCount,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const messages = await collect(channel, queue, Math.min(limit, before.messageCount));
  const replayed = [];

  for (const message of messages) {
    const routingKey = args['routing-key'] || originalRoutingKey(message, AVAILABILITY_ROUTING_KEY);
    const entry = {
      messageId: message.properties.messageId ?? null,
      type: message.properties.type ?? null,
      routingKey,
    };
    replayed.push(entry);

    if (dryRun) {
      // Devuelve el mensaje a la DLQ sin consumirlo de verdad.
      channel.nack(message, false, true);
      continue;
    }

    channel.publish(exchange, routingKey, message.content, {
      persistent: true,
      contentType: message.properties.contentType ?? 'application/json',
      contentEncoding: message.properties.contentEncoding ?? 'utf-8',
      messageId: message.properties.messageId,
      type: message.properties.type,
      correlationId: message.properties.correlationId,
      timestamp: Math.floor(Date.now() / 1000),
      appId: REPLAYED_BY,
      headers: replayedHeaders(message, args['keep-retry-count'] === true),
    });
    await channel.waitForConfirms();
    channel.ack(message);
  }

  const after = await channel.checkQueue(queue);
  await channel.close();
  await connection.close();

  process.stdout.write(
    `${JSON.stringify(
      {
        mode: dryRun ? 'dry-run' : 'replay',
        queue,
        exchange,
        available: before.messageCount,
        replayed: replayed.length,
        remaining: after.messageCount,
        messages: replayed,
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
