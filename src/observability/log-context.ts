import { parseTraceparent } from './trace-context';

export interface LogContextInput {
  correlationId?: string | null;
  traceparent?: unknown;
}

/**
 * Prefijo de log con el contexto del mensaje, por ejemplo
 * ` [correlationId=… traceId=… spanId=…]`. Devuelve cadena vacía si no hay
 * contexto, para no ensuciar los logs que no provienen de un evento.
 */
export function logContext(input: LogContextInput): string {
  const parts: string[] = [];

  if (input.correlationId) {
    parts.push(`correlationId=${input.correlationId}`);
  }

  const trace = parseTraceparent(input.traceparent);
  if (trace) {
    parts.push(`traceId=${trace.traceId}`, `spanId=${trace.spanId}`);
  }

  return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
}
