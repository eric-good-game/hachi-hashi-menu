/**
 * Shim solo para Jest. NestJS 12 publica ESM puro y el runner de Jest 30 no lo
 * puede requerir desde CommonJS. Las pruebas unitarias no necesitan el
 * contenedor de Nest: solo los decoradores y Logger.
 */
export function Injectable(): ClassDecorator {
  return (target) => target;
}

export function Inject(_token?: unknown): ParameterDecorator {
  return () => undefined;
}

export class Logger {
  constructor(_context?: string) {}

  log(..._args: unknown[]): void {}
  warn(..._args: unknown[]): void {}
  error(..._args: unknown[]): void {}
  debug(..._args: unknown[]): void {}
  verbose(..._args: unknown[]): void {}
}

export class UnauthorizedException extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedException';
  }
}
