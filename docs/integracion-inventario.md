# Integración con Inventory — traspaso desde Menu

Documento de traspaso para implementar **Inventory** sin leer la documentación completa de
Menu. Es autocontenido: incluye el contrato exacto, la semántica que aplica Menu, cómo
probar y qué decisiones quedan abiertas.

Fuentes de verdad si algo no cuadra: los esquemas de `contracts/` mandan sobre este texto, y
las decisiones están en `docs/decisiones-implementacion-menu.md`. Este documento resume solo
lo que Inventory necesita.

> Estado: el contrato `MenuItemAvailabilityChanged v1` es **provisional** (D-42) porque
> Inventory todavía no existe. Al implementarlo hay que confirmar los puntos de la sección 11.

## 1. Resumen para impacientes

- Menu **consume** `MenuItemAvailabilityChanged`. No llama a Inventory y no expone una API de
  escritura de disponibilidad en producción.
- Inventory **publica** en el exchange `hachi.events` (topic) con routing key
  `inventory.menu-item-availability-changed`.
- El sobre y el payload deben ir completos y exactos (v1). `source` debe ser `"inventory"`.
- Menu es **idempotente por `messageId`** y descarta eventos con `occurredAt` menor o igual a
  la última disponibilidad aplicada.
- La entrega es **at-least-once**. Menu reintenta 3 veces (5 s, 15 s, 45 s) y luego manda a la
  DLQ; Inventory no necesita reintentar por su cuenta más allá de su outbox.
- Inventory puede consumir `MenuItemUpdated` (`menu.menu-item-updated`) para conocer el
  catálogo. Menu **no** tiene replay ni backfill de eventos (ver sección 8).

## 2. Quién publica qué

| Dirección | Exchange | Routing key | Tipo | Declara la topología |
|---|---|---|---|---|
| Inventory → Menu | `hachi.events` (topic) | `inventory.menu-item-availability-changed` | `MenuItemAvailabilityChanged` v1 | Menu |
| Menu → consumidores | `hachi.events` (topic) | `menu.menu-item-updated` | `MenuItemUpdated` v1 | Menu |

Menu declara el exchange, sus colas y su DLQ al arrancar. Inventory solo necesita el
exchange; **no debe declarar `menu.inventory-events`** (sección 7).

## 3. Contrato que Inventory publica

### 3.1 Ejemplo exacto

```json
{
  "messageId": "d6a0b6e4-6d3b-4b8e-9d6f-1a2b3c4d5e6f",
  "type": "MenuItemAvailabilityChanged",
  "version": 1,
  "occurredAt": "2026-10-20T19:10:00Z",
  "source": "inventory",
  "correlationId": "0b6f2a9e-41c5-4c0e-8f3a-2d7e9b1a5c33",
  "causationId": null,
  "payload": {
    "menuItemId": "3f9a6d2e-8c14-4b7a-a5e0-91d2c7b84f10",
    "available": false
  }
}
```

Esquema: [`contracts/menu-item-availability-changed.v1.schema.json`](../contracts/menu-item-availability-changed.v1.schema.json)
y ejemplo en [`contracts/menu-item-availability-changed.v1.examples.json`](../contracts/menu-item-availability-changed.v1.examples.json).

### 3.2 Campos

| Campo | Tipo | Obligatorio | Regla |
|---|---|---|---|
| `messageId` | UUID | sí | Clave de idempotencia. **Estable ante reintentos**: se genera una vez, no por intento. |
| `type` | string | sí | Exactamente `"MenuItemAvailabilityChanged"`. |
| `version` | entero | sí | Exactamente `1`. |
| `occurredAt` | date-time | sí | Hora del **hecho** (no de publicación), ISO 8601 en UTC. Estrictamente creciente por platillo (ver 4.2). |
| `source` | string | sí | Exactamente `"inventory"`. |
| `correlationId` | UUID | sí | Trazabilidad. Si el cambio nace de una petición, propaga el de origen. |
| `causationId` | UUID o `null` | sí (el campo debe existir) | `null` si no hay evento causante. |
| `payload.menuItemId` | UUID | sí | Platillo de Menu. Es el `id` del menú. |
| `payload.available` | boolean | sí | `true` = se puede pedir; `false` = agotado. |

`additionalProperties` es `true` en el sobre y en el payload: campos extra **no** invalidan
el mensaje, pero Menu los ignora. Cualquier cambio de significado exige `version: 2`.

### 3.3 Qué invalida un mensaje

Menu valida con AJV 2020-12 + formatos. Un mensaje inválido va **directo a la DLQ**, sin
reintentos. Son inválidos, entre otros:

- Falta cualquiera de los campos obligatorios (incluido `causationId`).
- `type` distinto, `version` distinto de `1` o `source` distinto de `"inventory"`.
- `messageId`, `correlationId`, `causationId` o `menuItemId` que no sean UUID.
- `occurredAt` que no sea una fecha ISO 8601 válida.
- `available` que no sea booleano.

## 4. Qué hace Menu con el evento

### 4.1 Resultados posibles

| Resultado | Cuándo | Efecto |
|---|---|---|
| `applied` | Evento nuevo y más reciente | Actualiza `available` y `available_updated_at`. |
| `duplicate` | Ya existe ese `messageId` en `processed_message` | No hace nada. |
| `stale` | `occurredAt <= available_updated_at` | No aplica el cambio. |
| `unknown` | `menuItemId` no existe en Menu | Registra un warning y confirma el mensaje. |

- El chequeo de idempotencia, la actualización y el registro en `processed_message` ocurren
  en **una sola transacción**.
- `unknown` se confirma (no se reintenta): Menu no crea platillos ni avisa a Inventory.
- `available` se refleja en el detalle público (`GET /api/menu/items/{id}`) y en el filtro
  `available` del listado.
- Menu **no sube `revision`**, **no publica `MenuItemUpdated`** y no responde nada a Inventory
  cuando cambia la disponibilidad.

### 4.2 `occurredAt`: la parte que más se rompe

Menu descarta `occurredAt <= available_updated_at` (comparación **inclusiva**). Consecuencias:

- Un evento tardío pero más nuevo se aplica; uno más viejo se descarta. El orden de llegada no
  importa, el orden por `occurredAt` sí.
- **Riesgo real:** dos cambios del mismo platillo en el mismo milisegundo. El segundo se
  descarta como viejo y la disponibilidad queda en el valor del primero. Inventory debe
  garantizar timestamps estrictamente crecientes por platillo (reloj monótono o incremento de
  1 ms si coincide).
- `occurredAt` debe ser la hora del hecho, no la de publicación: si el outbox se retrasa, un
  evento publicado tarde sigue siendo válido si su `occurredAt` es el correcto.

## 5. Entrega, orden y reintentos

- **At-least-once**: Inventory puede publicar duplicados sin miedo; Menu deduplica por
  `messageId`.
- **Orden**: no se exige orden global ni orden entre platillos. Solo importa la monotonía de
  `occurredAt` por platillo.
- **Reintentos de Menu** (no configurables por Inventory): los fallos transitorios se
  reprograman en `menu.inventory-events.retry.{1,2,3}` con TTL de 5 s, 15 s y 45 s
  (`RABBITMQ_RETRY_TTLS_MS`), y tras 3 intentos (`CONSUMER_MAX_RETRIES`) van a la DLQ. El
  contador viaja en la cabecera `x-retry-count`, que gestiona Menu; Inventory no la envía.
- **Contrato inválido** → DLQ inmediata, sin reintentos.
- **Concurrencia**: Menu consume con `prefetch(1)`, así que procesa en serie por instancia.
  Para un restaurante es suficiente; si Inventory generara ráfagas grandes, Menu puede
  escalar réplicas (el consumidor es idempotente).
- Colas y exchanges son **durables**: si Menu está caído, el broker retiene los mensajes.

## 6. Cómo publicar desde Inventory (recomendación)

Menu ya resolvió estos problemas (D-33 y D-48); sirven de referencia:

1. **Outbox transaccional**: en la misma transacción que cambia el stock, inserta el evento
   pendiente. Un relay lo publica después.
2. **Publisher confirms**: espera la confirmación del broker antes de marcar como publicado.
   Si falla, reintenta sin avanzar (conserva el orden por secuencia).
3. **Un solo publicador** si hay varias instancias: lease en base de datos (como Menu) o
   particionado. Con dos relays sin bloqueo se publican duplicados (inofensivos por la
   idempotencia, pero ruidosos).
4. **`messageId` estable**: se genera al insertar en el outbox y se reutiliza en cada
   reintento. Si se regenera, Menu no puede deduplicar.
5. **Propiedades AMQP** que usa Menu, por consistencia:
   `persistent: true`, `contentType: application/json`, `contentEncoding: utf-8`, y en las
   propiedades `messageId`, `type`, `correlationId`, `timestamp`, `appId: 'inventory'`.
6. **`traceparent` opcional**: Menu publica un `traceparent` W3C y lo propaga en los
   reintentos. Si Inventory lo añade en `headers`, la traza se continúa (D-49).
7. **Suprime cambios sin efecto**: si `available` no cambia, no publiques (no rompe nada,
   pero ensucia métricas y logs).

## 7. Topología exacta y quién la declara

| Elemento | Nombre | Argumentos | Dueño |
|---|---|---|---|
| Exchange de eventos | `hachi.events` | `topic`, durable | Menu |
| Routing key de Inventory | `inventory.menu-item-availability-changed` | — | — |
| Cola de Menu | `menu.inventory-events` | durable, `x-dead-letter-exchange: hachi.dlx`, `x-dead-letter-routing-key: menu.inventory-events.dlq` | Menu |
| Exchange de descarte | `hachi.dlx` | `direct`, durable | Menu |
| Cola de descartes | `menu.inventory-events.dlq` | durable | Menu |
| Exchange de reintento | `hachi.retry` | `direct`, durable | Menu |
| Colas de reintento | `menu.inventory-events.retry.{1,2,3}` | TTL 5/15/45 s, dead-letter a `hachi.events` | Menu |
| Routing keys de reintento | `availability.retry.{1,2,3}` | Solo internas de Menu | Menu |

**Inventory solo debe usar `hachi.events` + su routing key.** No declare
`menu.inventory-events`: si lo hace con argumentos distintos, el broker responde
`PRECONDITION_FAILED` y Menu no podrá consumir. Tampoco publique en `hachi.dlx`, `hachi.retry`
ni en las routing keys de reintento.

## 8. Catálogo: cómo sabe Inventory qué platillos existen

Menu **no** tiene endpoint de exportación ni replay/backfill de eventos. Opciones, de menos a
más acopladas:

| Opción | Cuándo usarla |
|---|---|
| `contracts/seed/menu-item-ids.json` | Etapa A: 30 platillos semilla con UUID deterministas y su `slug`. |
| `GET /api/menu/admin/items?page=1&size=100` con JWT de rol `admin` | Import inicial completo (incluye inactivos). Paginado; `size` máximo 100. |
| `GET /api/menu/items?page=1&size=100` (público) | Solo platillos activos de categorías activas. Paginado; `size` máximo 100. |
| Consumir `MenuItemUpdated` | Mantener el catálogo al día después del import inicial. |

`MenuItemUpdated` (v1) incluye:

| Campo | Nota |
|---|---|
| `menuItemId` | UUID del platillo. |
| `revision` | Contador de revisiones de Menu (bloqueo optimista). **Ordena por `revision`, no por `occurredAt`.** |
| `name`, `priceCents`, `currency`, `categoryId`, `categoryName`, `active` | Estado del catálogo. |

- **No incluye `available`**: la disponibilidad solo llega por el evento de Inventory.
- Si lo consumes, deduplica por `messageId` y ordena por `revision` (la entrega es
  at-least-once y puede llegar desordenada).
- Un cambio de nombre de categoría emite **un evento por platillo** afectado y sube su
  `revision`.
- Un platillo se crea inactivo (`active: false`) y se activa después.
- Ante un `menuItemId` desconocido, Inventory no debe publicar disponibilidad hasta tenerlo
  en su catálogo (Menu lo descartaría como `unknown`).

## 9. Cómo probar sin Inventory completo

Contra Menu en la etapa A, con RabbitMQ y el consumidor de Menu levantados
(`docker compose --profile messaging up -d rabbitmq`):

```bash
# 1. Publicar el evento real al exchange (simulador de Inventory de Menu)
pnpm dev:publish-availability -- --menu-item-id <uuid> --available false

# Variantes útiles
pnpm dev:publish-availability -- --menu-item-id <uuid> --available false --invalid
pnpm dev:publish-availability -- --menu-item-id <uuid> --repeat 3

# 2. Comprobar el efecto en el menú público
curl -s http://localhost:3000/api/menu/items/<uuid> | jq '{available, revision}'
```

- El endpoint `PUT /api/menu/dev/items/{id}/availability` es el simulador de la etapa A
  (requiere `DEV_TOOLS_ENABLED=true`); en modo integrado responde 404. No es una API para
  Inventory. El script `dev:publish-availability` publica directo al broker, así que no
  depende de ese endpoint.
- IDs de los 30 platillos semilla: [`contracts/seed/menu-item-ids.json`](../contracts/seed/menu-item-ids.json).
- Patrón de pruebas de integración: `test/integration/hito3-messaging.test.ts` de Menu
  (PostgreSQL y RabbitMQ reales con Testcontainers).
- Observabilidad del lado de Menu: `GET /metrics` (`menu_availability_consumer_processed_total`,
  `..._dead_letters_total{reason}`, `..._failures_total`, `menu_availability_queue_messages`).
- Si algo acaba en la DLQ de Menu: `pnpm replay:dlq -- --dry-run --limit 10` y
  [`docs/runbook-operacion.md`](runbook-operacion.md).

## 10. Lo que Inventory no debe hacer

- Llamar a la API de Menu para escribir disponibilidad.
- Publicar `MenuItemUpdated` (es de Menu).
- Asumir que Menu valida platillos o devuelve un ack de negocio.
- Regenerar `messageId` al reintentar.
- Enviar `occurredAt` de publicación en lugar de la hora del hecho.
- Omitir `causationId` (debe estar, aunque sea `null`).
- Enviar su propio `x-retry-count` (lo gestiona Menu).
- Declarar o purgar las colas de Menu.

## 11. Decisiones abiertas a confirmar al implementar Inventory

- [ ] ¿El payload final se queda en `menuItemId` + `available`, o Inventory necesita añadir
      algo (por ejemplo `stockLevel` o `reason`)? Menu ignora campos extra, pero un cambio
      semántico exige `version: 2`.
- [ ] Garantía de `occurredAt` **estrictamente creciente** por platillo (sección 4.2).
- [ ] ¿Inventory consumirá `MenuItemUpdated`? Definir el import inicial y la reconciliación,
      porque Menu no tiene replay de eventos.
- [ ] Volumen esperado y picos (afecta al `prefetch(1)` y al número de réplicas de Menu).
- [ ] ¿Quién alerta y opera la DLQ: Menu (hoy) o la plataforma?
- [ ] Sincronización de reloj (NTP) entre Inventory y Menu: `occurredAt` viene de Inventory.

## 12. Referencias mínimas

| Documento | Para qué |
|---|---|
| `contracts/menu-item-availability-changed.v1.schema.json` | Contrato exacto que Inventory debe cumplir. |
| `contracts/menu-item-updated.v1.schema.json` | Si Inventory consume el catálogo. |
| `contracts/README.md` | Checklist de confirmación del contrato provisional. |
| `docs/decisiones-implementacion-menu.md` | D-33 (relay), D-34 (topología), D-35 (reintentos/DLQ), D-36 (consumidor), D-42 (contrato provisional), D-48 (lease), D-49/D-50 (métricas y replay). |
| `docs/runbook-operacion.md` | Qué hacer si la DLQ crece o el consumidor falla. |
