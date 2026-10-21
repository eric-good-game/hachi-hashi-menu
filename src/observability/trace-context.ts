import { randomBytes } from 'node:crypto';

/**
 * Propagación de contexto de traza en formato W3C `traceparent`.
 *
 * No incluimos un colector de trazas: el objetivo es que relay y consumidor
 * propaguen `traceparent` y `correlationId` en los mensajes y en los logs, de
 * modo que un colector (OpenTelemetry o el que provea la plataforma) pueda
 * continuar la traza sin cambios en el dominio.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[0-9a-f]|ff)$/i;

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

/** Inicia una traza nueva: el relay publica sin una petición entrante que continuar. */
export function startTraceparent(): string {
  return formatTraceparent(newTraceId(), newSpanId());
}

export function parseTraceparent(value: unknown): TraceContext | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = TRACEPARENT_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  return { traceId: match[1]!.toLowerCase(), spanId: match[2]!.toLowerCase() };
}

/**
 * Continúa la traza recibida con un span nuevo. Si el header falta o es
 * inválido, empieza una traza nueva en lugar de descartar el mensaje.
 */
export function continueTraceparent(value: unknown): string {
  const parsed = parseTraceparent(value);
  return parsed ? formatTraceparent(parsed.traceId, newSpanId()) : startTraceparent();
}
