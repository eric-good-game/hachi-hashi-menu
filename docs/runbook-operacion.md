# Runbook de operación — Menu/Catalog

Guía para operar el relay del Outbox y el consumidor de disponibilidad:
qué métricas expone el servicio, qué significan las alertas de
[`ops/prometheus/alerts.yml`](../ops/prometheus/alerts.yml) y cómo reparar cada
situación. Es un documento vivo: se actualiza cuando cambia la topología o la
instrumentación.

## Alcance

Aplica al servicio **Menu/Catalog** en modo mensajería (`OUTBOX_PUBLISH_ENABLED`
y/o `CONSUMERS_ENABLED`). No cubre la API pública ni las fotos. Inventory e
Identity todavía no existen (D-42): el contrato `MenuItemAvailabilityChanged` es
provisional.

## Métricas expuestas

`GET /metrics` devuelve el formato de texto de Prometheus. No pasa por el
prefijo `/api` y **no está autenticado**: debe publicarse solo en la red interna
o detrás del recolector. `METRICS_ENABLED=false` lo desactiva (responde 404).

| Métrica | Tipo | Significado |
|---|---|---|
| `menu_outbox_pending_events` | gauge | Eventos del Outbox sin publicar; se actualiza en cada ciclo del relay con lease. |
| `menu_outbox_relay_published_total` | counter | Eventos publicados por esta instancia. |
| `menu_outbox_relay_failures_total` | counter | Fallos al publicar un evento. |
| `menu_outbox_relay_cycle_errors_total` | counter | Errores no controlados en un ciclo del relay. |
| `menu_outbox_relay_lease_held` | gauge | `1` si esta instancia posee el lease del relay (D-48), `0` si no. |
| `menu_outbox_relay_lease_acquisitions_total` | counter | Veces que esta instancia adquirió el lease. |
| `menu_availability_consumer_processed_total{status}` | counter | Mensajes aplicados por resultado: `applied`, `duplicate`, `stale`, `unknown`. |
| `menu_availability_consumer_failures_total` | counter | Errores transitorios al aplicar disponibilidad. |
| `menu_availability_consumer_retries_total` | counter | Mensajes reprogramados en una cola de reintento. |
| `menu_availability_consumer_dead_letters_total{reason}` | counter | Mensajes enviados a la DLQ: `invalid_contract` o `retries_exhausted`. |
| `menu_availability_consumer_duration_seconds{status}` | histogram | Duración de la aplicación de un cambio de disponibilidad. |
| `menu_availability_queue_messages{queue}` | gauge | Mensajes en espera en `menu.inventory-events` y su DLQ; se consulta de forma pasiva cada `QUEUE_METRICS_INTERVAL_MS` (15 s). |

Las métricas con `*_total` son por proceso: Prometheus las agrega entre
réplicas. Los gauges globales (`menu_outbox_pending_events`,
`menu_availability_queue_messages`) se publican solo desde las instancias que
tienen el relay o el consumidor habilitados.

El broker también expone `rabbitmq_queue_messages` si se habilita el plugin
`rabbitmq_prometheus` (incluido en `rabbitmq:3.13-management-alpine`):

```bash
docker compose exec rabbitmq rabbitmq-plugins enable rabbitmq_prometheus
```

## Diagnóstico rápido

```bash
# Profundidad de colas
docker compose exec rabbitmq rabbitmqctl list_queues name messages

# Eventos pendientes y fallidos
psql "$DATABASE_URL" -c \
  'select count(*) filter (where published_at is null) as pending,
          coalesce(max(attempts), 0)                    as max_attempts
     from outbox_event;'

# Estado del lease
psql "$DATABASE_URL" -c 'select * from relay_lock;'

# Registro de mensajes procesados
psql "$DATABASE_URL" -c 'select count(*) from processed_message;'
```

Los logs del relay y del consumidor incluyen
`[correlationId=… traceId=… spanId=…]` (D-49): usa ese `correlationId` para
seguir un cambio de disponibilidad de extremo a extremo, y el `traceId` para
correlacionarlo con los spans cuando exista un colector.

## Outbox atascado

Síntoma: `menu_outbox_pending_events` crece, `MenuOutboxBacklog*` o
`MenuOutboxRelayStalled` disparan.

1. Comprueba que **alguna** instancia publica: `sum(menu_outbox_relay_lease_held)`
   debe ser `1`. Si es `0`, ve a [Relay sin lease](#relay-sin-lease).
2. Mira `increase(menu_outbox_relay_failures_total[15m])`. Si hay fallos, el
   broker no confirma las publicaciones:
   - Revisa la conectividad con RabbitMQ (`RABBITMQ_URL`, credenciales, red).
   - Verifica los exchanges y colas con `rabbitmqctl list_exchanges` y
     `rabbitmqctl list_queues`.
3. Revisa `outbox_event.attempts` y `last_error`; el relay reintenta con espera
   creciente y **no avanza** al siguiente evento, así que el orden por `seq`
   está intacto aunque la publicación se retrase.
4. Un evento con contrato inválido también detiene el relay (`last_error` dirá
   "no cumple el contrato"). Corrige el evento o su origen; no lo borres a mano
   sin decidirlo.

## Relay sin lease

Síntoma: `sum(menu_outbox_relay_lease_held) == 0` con
`OUTBOX_PUBLISH_ENABLED=true` y `OUTBOX_RELAY_LOCK_ENABLED=true`.

1. Comprueba que las migraciones están aplicadas: `select * from relay_lock;`
   debe funcionar.
2. Revisa los logs de cada réplica: "otra instancia posee el lease" en todas
   significa que el lease está tomado pero la instancia que lo tiene no reporta
   el gauge (por ejemplo, está reiniciando). "lease adquirido" reciente indica
   recuperación automática.
3. Si PostgreSQL estuvo caído, el lease caduca según `OUTBOX_RELAY_LEASE_MS`
   (15 s) y otra réplica lo toma sola. No hace falta intervenir.
4. Como último recurso, con el relay detenido:
   `delete from relay_lock where name = 'outbox-relay';`. Es seguro: la
   siguiente instancia lo recrea al arrancar.

## Consumidor con errores

Síntoma: `menu_availability_consumer_failures_total` crece o
`MenuAvailabilityQueueBacklog` dispara.

1. Un fallo transitorio deja el mensaje en una cola de reintento con TTL
   creciente (5 s, 15 s, 45 s por defecto). Si se recupera, se aplica y se
   confirma; no requiere intervención.
2. Si los fallos son por la base de datos, comprueba conexiones y latencia.
3. Si siempre falla el **mismo** `messageId`, es un mensaje venenoso: agotará los
   reintentos y acabará en la DLQ. Ve a [DLQ con mensajes](#dlq-con-mensajes).
4. Si la cola principal crece sin fallos, el consumidor no da abasto: revisa la
   latencia de escritura y escala réplicas. El consumidor es idempotente, así
   que varias réplicas son seguras.

## DLQ con mensajes

Síntoma: `menu_availability_queue_messages{queue="menu.inventory-events.dlq"} > 0`
o `MenuAvailabilityDeadLetters`.

La etiqueta `reason` distingue dos casos:

- **`invalid_contract`**: el sobre o el payload no cumplen el esquema AJV. Casi
  siempre es un bug del productor. Inspecciona el mensaje, corrige el origen y
  decide si el contenido es recuperable. Reprogramar un contrato inválido solo
  lo devuelve a la DLQ.
- **`retries_exhausted`**: el servicio falló de forma persistente al aplicarlo.
  Corrige la causa (por ejemplo la base de datos) y reprograma.

Aísla un mensaje para inspeccionarlo sin perderlo:

```bash
docker compose exec rabbitmq rabbitmqadmin get queue=menu.inventory-events.dlq count=1 requeue=true
```

Reprogra los mensajes de vuelta a `hachi.events`:

```bash
# Ver qué se reprogramaría, sin publicar ni confirmar
pnpm replay:dlq -- --dry-run --limit 10

# Reprogramar hasta 100 mensajes
pnpm replay:dlq -- --limit 100
```

El script conserva el `messageId` original para que la idempotencia del
consumidor evite aplicar dos veces un cambio ya aplicado, reinicia
`x-retry-count` (usa `--keep-retry-count` para conservarlo) y deja
`x-replayed-at`/`x-replayed-by` en las cabeceras. La routing key se toma del
`x-death` original y, si no está, de la de disponibilidad; se puede forzar con
`--routing-key`.

Después de reprogramar:

1. Confirma que la DLQ queda a cero y que
   `menu_availability_consumer_processed_total` avanza.
2. Si los mensajes vuelven a la DLQ, no los reprogrames en bucle: corrige la
   causa raíz.
3. Anota el incidente y, si el contrato era inválido, abre la corrección en el
   productor.

## Trazas y correlación

No hay colector de trazas todavía (D-49). El servicio propaga el contexto:

- El relay publica cada evento con un `traceparent` nuevo (formato W3C) y el
  `correlationId` del sobre.
- El consumidor continúa el `traceparent` recibido al reprogramar un reintento y
  registra `correlationId`, `traceId` y `spanId` en los logs.
- Al integrar un colector (OpenTelemetry u otro), basta con exportar los spans
  usando ese contexto: la propagación ya viaja en los mensajes.

## Limitaciones conocidas

- Las métricas viven en memoria del proceso: un reinicio las pone a cero. Los
  contadores acumulados requieren `rate()`/`increase()` sobre el histórico.
- `menu_availability_queue_messages` requiere `CONSUMERS_ENABLED=true` y
  `METRICS_ENABLED=true`; si el broker no responde, el gauge conserva su último
  valor (los logs de debug lo dicen).
- Las alertas de profundidad de cola dependen del plugin Prometheus del broker;
  sin él, usa `rabbitmqctl list_queues` o el contador
  `menu_availability_consumer_dead_letters_total`.
