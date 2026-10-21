import { logContext } from './log-context';
import { formatTraceparent } from './trace-context';

const TRACE_ID = '1'.repeat(32);
const SPAN_ID = '2'.repeat(16);
const TRACEPARENT = formatTraceparent(TRACE_ID, SPAN_ID);

describe('logContext', () => {
  it('incluye correlationId, traceId y spanId cuando hay contexto', () => {
    expect(logContext({ correlationId: 'corr-1', traceparent: TRACEPARENT })).toBe(
      ` [correlationId=corr-1 traceId=${TRACE_ID} spanId=${SPAN_ID}]`,
    );
  });

  it('incluye solo el correlationId si no hay traza válida', () => {
    expect(logContext({ correlationId: 'corr-1', traceparent: 'inválido' })).toBe(
      ' [correlationId=corr-1]',
    );
  });

  it('devuelve cadena vacía sin contexto para no ensuciar los logs', () => {
    expect(logContext({})).toBe('');
    expect(logContext({ correlationId: null, traceparent: undefined })).toBe('');
  });
});
