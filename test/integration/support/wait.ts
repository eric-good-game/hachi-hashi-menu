export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  description?: string;
}

/**
 * Espera hasta que `predicate` acepte el valor devuelto por `get`.
 * Se usa polling con límite para no depender de esperas fijas.
 */
export async function waitFor<T>(
  get: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: WaitOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await get();
      lastValue = value;
      if (predicate(value)) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }

  const description = options.description ?? 'condición';
  const detail =
    lastError instanceof Error
      ? `; último error: ${lastError.message}`
      : `; último valor: ${JSON.stringify(lastValue)}`;
  throw new Error(`Tiempo agotado esperando ${description}${detail}`);
}
