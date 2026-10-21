import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { AppEnv } from '../../config/env.schema';
import type { EventBusPort } from '../../catalog/application/ports/event-bus';
import type { OutboxRepository } from '../../catalog/application/ports/repositories';
import type { ClockPort } from '../../catalog/application/ports/system';
import { CLOCK, EVENT_BUS, OUTBOX_REPOSITORY, RELAY_LOCK } from '../../catalog/catalog.tokens';
import { ContractValidator } from '../../events/contract-validator';
import type { RelayLockPort } from './ports/relay-lock';
import { toOutboxEnvelope } from './outbox-envelope';

const MAX_BACKOFF_MS = 30_000;
const LEASE_NAME = 'outbox-relay';

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly instanceId: string;
  private readonly lockEnabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private polling = false;
  private consecutiveFailures = 0;
  private holdsLease = false;
  private loggedLockout = false;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(EVENT_BUS) private readonly bus: EventBusPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject('APP_ENV') private readonly env: AppEnv,
    private readonly validator: ContractValidator,
    @Inject(RELAY_LOCK) private readonly lock: RelayLockPort,
  ) {
    this.lockEnabled = env.OUTBOX_RELAY_LOCK_ENABLED;
    // El sufijo aleatorio distingue dos instancias que compartan host y pid
    // (por ejemplo, dos aplicaciones en el mismo proceso de pruebas).
    this.instanceId = env.OUTBOX_RELAY_INSTANCE_ID ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  }

  onApplicationBootstrap(): void {
    if (!this.env.OUTBOX_PUBLISH_ENABLED) {
      this.logger.log('Relay del Outbox deshabilitado');
      return;
    }

    this.logger.log(
      `Relay del Outbox activo: instancia ${this.instanceId}, lote ${this.env.OUTBOX_BATCH_SIZE}, ` +
        `intervalo ${this.env.OUTBOX_POLL_INTERVAL_MS} ms, bloqueo ${
          this.lockEnabled ? `activo (lease ${this.env.OUTBOX_RELAY_LEASE_MS} ms)` : 'deshabilitado'
        }`,
    );
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.lockEnabled && this.holdsLease) {
      this.holdsLease = false;
      await this.lock.release(LEASE_NAME, this.instanceId).catch((error: unknown) => {
        this.logger.warn(
          'No se pudo liberar el lease del relay al apagar',
          error instanceof Error ? error.message : String(error),
        );
      });
    }
  }

  /**
   * Publica como máximo un lote y devuelve cuántos eventos se confirmaron.
   * Es público para probar el orden y el manejo de fallos sin arrancar el loop.
   *
   * Con el bloqueo activo, si otra instancia posee el lease el ciclo no publica
   * nada; y el lease se renueva antes de cada evento, así que si lo perdemos a
   * mitad del lote nos detenemos sin publicar el resto.
   */
  async pollOnce(): Promise<number> {
    if (this.polling) {
      return 0;
    }
    this.polling = true;

    try {
      if (this.lockEnabled && !(await this.renewLease())) {
        return 0;
      }

      const events = await this.outbox.listUnpublished(this.env.OUTBOX_BATCH_SIZE);
      let published = 0;

      for (const event of events) {
        if (this.lockEnabled && !(await this.renewLease())) {
          break;
        }

        try {
          const envelope = toOutboxEnvelope(event);
          this.validator.validateMenuItemUpdated(envelope);
          await this.bus.publish(event.routingKey, envelope);
          await this.outbox.markPublished(event.seq, this.clock.now());
          published += 1;
          this.consecutiveFailures = 0;
        } catch (error) {
          this.consecutiveFailures += 1;
          await this.outbox.recordFailure(event.seq, this.describe(error)).catch((recordError: unknown) => {
            this.logger.error(
              `No se pudo registrar el fallo del evento ${event.id}`,
              recordError instanceof Error ? recordError.stack : String(recordError),
            );
          });
          this.logger.warn(
            `No se pudo publicar el evento ${event.id} (seq ${event.seq}); ` +
              `se reintentará antes de avanzar al siguiente`,
            error instanceof Error ? error.stack : String(error),
          );
          break;
        }
      }

      return published;
    } finally {
      this.polling = false;
    }
  }

  /** Adquiere o renueva el lease y registra la transición de dueño. */
  private async renewLease(): Promise<boolean> {
    const owned = await this.lock.acquire(LEASE_NAME, this.instanceId, this.env.OUTBOX_RELAY_LEASE_MS);

    if (owned) {
      if (!this.holdsLease) {
        this.logger.log('Relay del Outbox: lease adquirido, esta instancia publica');
      }
      this.holdsLease = true;
      this.loggedLockout = false;
      return true;
    }

    this.holdsLease = false;
    if (!this.loggedLockout) {
      this.logger.log('Relay del Outbox: otra instancia posee el lease; se omite este ciclo');
      this.loggedLockout = true;
    }
    return false;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delayMs);
  }

  private async runCycle(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (error) {
      this.consecutiveFailures += 1;
      this.logger.error(
        'Falló el ciclo del relay del Outbox',
        error instanceof Error ? error.stack : String(error),
      );
    }

    if (this.stopped) {
      return;
    }

    const delay =
      this.consecutiveFailures > 0
        ? Math.min(
            this.env.OUTBOX_POLL_INTERVAL_MS * 2 ** Math.min(this.consecutiveFailures, 5),
            MAX_BACKOFF_MS,
          )
        : this.env.OUTBOX_POLL_INTERVAL_MS;

    this.schedule(delay);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
