/**
 * Lease cooperativo para que una sola instancia del relay del Outbox publique a
 * la vez (D-48). El contrato es deliberadamente mínimo: adquirir/renovar y
 * liberar. Un lease expirado lo puede tomar otra instancia, de modo que una
 * caída del publicador se recupera sin intervención.
 */
export interface RelayLockPort {
  /**
   * Adquiere el lease si está libre o ya pertenece a `holder`, y lo renueva
   * hasta `ttlMs` en el futuro. Devuelve `true` solo si `holder` lo posee.
   */
  acquire(name: string, holder: string, ttlMs: number): Promise<boolean>;

  /** Libera el lease si pertenece a `holder` (operación idempotente). */
  release(name: string, holder: string): Promise<void>;
}
