import {
  continueTraceparent,
  formatTraceparent,
  newSpanId,
  newTraceId,
  parseTraceparent,
  startTraceparent,
} from './trace-context';

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('trace-context', () => {
  it('genera identificadores con la longitud del estándar W3C', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('formatea un traceparent válido y lo vuelve a leer', () => {
    const traceparent = formatTraceparent('a'.repeat(32), 'b'.repeat(16));

    expect(traceparent).toBe(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
    expect(parseTraceparent(traceparent)).toEqual({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    });
  });

  it('inicia una traza nueva cuando no hay contexto previo', () => {
    expect(startTraceparent()).toMatch(TRACEPARENT);
  });

  it('continúa la traza con un span nuevo y conserva el traceId', () => {
    const parent = formatTraceparent('c'.repeat(32), 'd'.repeat(16));

    const child = continueTraceparent(parent);

    expect(child).toMatch(TRACEPARENT);
    expect(parseTraceparent(child)?.traceId).toBe('c'.repeat(32));
    expect(parseTraceparent(child)?.spanId).not.toBe('d'.repeat(16));
  });

  it('inicia una traza nueva si el header falta o es inválido', () => {
    for (const invalid of [undefined, null, 42, 'no-es-un-traceparent', '00-abc-def-01']) {
      expect(continueTraceparent(invalid)).toMatch(TRACEPARENT);
      expect(parseTraceparent(invalid)).toBeNull();
    }
  });

  it('acepta el flag de muestreo distinto de 01', () => {
    expect(parseTraceparent(`00-${'e'.repeat(32)}-${'f'.repeat(16)}-00`)).toEqual({
      traceId: 'e'.repeat(32),
      spanId: 'f'.repeat(16),
    });
  });
});
