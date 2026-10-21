import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { AvailabilityChangeStatus } from '../catalog/application/ports/availability-inbound';

export type DeadLetterReason = 'invalid_contract' | 'retries_exhausted';

/**
 * Registro de métricas Prometheus del servicio (D-49).
 *
 * Los contadores viven en memoria del proceso: cada réplica expone los suyos y
 * Prometheus los agrega al raspar. El estado global (pendientes del Outbox,
 * profundidad de colas) se publica como gauge actualizado periódicamente.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  readonly outboxPendingEvents = new Gauge({
    name: 'menu_outbox_pending_events',
    help: 'Eventos del Outbox sin publicar',
    registers: [this.registry],
  });

  readonly outboxRelayPublished = new Counter({
    name: 'menu_outbox_relay_published_total',
    help: 'Eventos del Outbox publicados por esta instancia',
    registers: [this.registry],
  });

  readonly outboxRelayFailures = new Counter({
    name: 'menu_outbox_relay_failures_total',
    help: 'Fallos al publicar un evento del Outbox',
    registers: [this.registry],
  });

  readonly outboxRelayCycleErrors = new Counter({
    name: 'menu_outbox_relay_cycle_errors_total',
    help: 'Errores no controlados en un ciclo del relay',
    registers: [this.registry],
  });

  readonly outboxRelayLeaseHeld = new Gauge({
    name: 'menu_outbox_relay_lease_held',
    help: '1 si esta instancia posee el lease del relay, 0 si no',
    registers: [this.registry],
  });

  readonly outboxRelayLeaseAcquisitions = new Counter({
    name: 'menu_outbox_relay_lease_acquisitions_total',
    help: 'Veces que esta instancia adquirió el lease del relay',
    registers: [this.registry],
  });

  readonly availabilityProcessed = new Counter<'status'>({
    name: 'menu_availability_consumer_processed_total',
    help: 'Mensajes de disponibilidad procesados, por resultado',
    labelNames: ['status'],
    registers: [this.registry],
  });

  readonly availabilityFailures = new Counter({
    name: 'menu_availability_consumer_failures_total',
    help: 'Errores transitorios al aplicar disponibilidad',
    registers: [this.registry],
  });

  readonly availabilityRetries = new Counter({
    name: 'menu_availability_consumer_retries_total',
    help: 'Mensajes de disponibilidad reprogramados para reintento',
    registers: [this.registry],
  });

  readonly availabilityDeadLetters = new Counter<'reason'>({
    name: 'menu_availability_consumer_dead_letters_total',
    help: 'Mensajes enviados a la DLQ, por motivo',
    labelNames: ['reason'],
    registers: [this.registry],
  });

  readonly availabilityDuration = new Histogram<'status'>({
    name: 'menu_availability_consumer_duration_seconds',
    help: 'Duración de la aplicación de un cambio de disponibilidad',
    labelNames: ['status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });

  readonly availabilityQueueMessages = new Gauge<'queue'>({
    name: 'menu_availability_queue_messages',
    help: 'Mensajes en espera en las colas de disponibilidad',
    labelNames: ['queue'],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'hachi-hashi-menu' });
    collectDefaultMetrics({ register: this.registry });
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  recordAvailabilityResult(status: AvailabilityChangeStatus, durationSeconds: number): void {
    this.availabilityProcessed.inc({ status });
    this.availabilityDuration.observe({ status }, durationSeconds);
  }
}
