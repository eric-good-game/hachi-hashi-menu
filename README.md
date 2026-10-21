# Hachi Hashi — Menu/Catalog

[![CI](https://github.com/eric-good-game/hachi-hashi-menu/actions/workflows/ci.yml/badge.svg)](https://github.com/eric-good-game/hachi-hashi-menu/actions/workflows/ci.yml)

Servicio dueño del menú del restaurante: platillos, categorías, precios, alérgenos y fotos.
Construido con NestJS, Prisma y PostgreSQL.

Este repositorio contiene los **Hitos 1, 2 y 3**: creación y edición de platillos, revisión
de alérgenos, activación, categorías con sus reglas de estado y borrado, fotos en disco
local, consulta pública paginada, menú público con ETag y Outbox transaccional; relay del
Outbox a RabbitMQ, consumidor de disponibilidad, autenticación JWT y validación de contratos
con AJV. Las decisiones tomadas y el alcance diferido están en
[`docs/decisiones-implementacion-menu.md`](docs/decisiones-implementacion-menu.md).

## Requisitos

- Node.js 22 o superior
- pnpm 11
- Docker (para PostgreSQL; RabbitMQ es opcional y solo se necesita para el Hito 3)

## Inicio rápido

```bash
pnpm install
docker compose up -d menu-db
pnpm db:deploy
pnpm start:dev
```

Para el flujo completo de mensajería, levanta también RabbitMQ y activa el relay y el
consumidor:

```bash
docker compose --profile messaging up -d rabbitmq
OUTBOX_PUBLISH_ENABLED=true \
CONSUMERS_ENABLED=true \
RABBITMQ_URL=amqp://menu:menu@localhost:5672 \
pnpm start:dev
```

El relay solo publica si `OUTBOX_PUBLISH_ENABLED=true`; el consumidor solo escucha si
`CONSUMERS_ENABLED=true`. Con ambas banderas en `false` el servicio funciona en modo A y
los eventos quedan en el Outbox sin publicarse.

El servicio queda en `http://localhost:3000`, la documentación en
`http://localhost:3000/api/docs` y la salud en `http://localhost:3000/health`.

La semilla (`SEED_ON_START=true`) carga los 11 alérgenos, las 7 categorías base y
30 platillos con UUID deterministas. Es idempotente y no sobrescribe cambios hechos por
administración. Los IDs publicados para Inventory están en
[`contracts/seed/menu-item-ids.json`](contracts/seed/menu-item-ids.json).

Para levantar todo en contenedores:

```bash
docker compose up --build
```

Las fotos se guardan en el volumen `menu-photos`, montado en `/app/var/photos`.

## Autenticación

### Modo desarrollo

En `AUTH_MODE=dev` se usan tokens fijos:

| Token | Rol | Uso |
|---|---|---|
| `dev-admin-token` | administrador | Endpoints `/api/menu/admin/*` |
| `dev-viewer-token` | solo lectura | Debe recibir 403 en administración |

```bash
curl http://localhost:3000/api/menu/admin/items \
  -H 'Authorization: Bearer dev-admin-token'
```

Sin token se devuelve 401. Los errores usan `application/problem+json`.

### Modo JWT

Con `AUTH_MODE=jwt` se valida un JWT **RS256** con `JWT_PUBLIC_KEY` o
`JWT_PUBLIC_KEY_FILE`. El token debe incluir `sub` y roles en el claim `roles` (o, como
alternativa, en `realm_access.roles`). La administración exige el rol `admin`.

```bash
AUTH_MODE=jwt \
JWT_PUBLIC_KEY_FILE=/ruta/a/public.pem \
pnpm start:dev
```

La clave pública se carga al arrancar y se usa para validar cada token. No se consulta JWKS en esta etapa; Identity debe
entregar la clave por configuración o archivo.

## Endpoints

### Públicos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Salud del servicio y su base |
| GET | `/api/menu` | Menú completo con ETag |
| GET | `/api/menu/categories` | Categorías activas |
| GET | `/api/menu/allergens` | Catálogo de alérgenos |
| GET | `/api/menu/items` | Platillos activos con filtros y paginación |
| GET | `/api/menu/items/{id}` | Detalle de un platillo activo |
| GET | `/api/menu/media/{file}` | Foto de un platillo con ETag |

`GET /api/menu/items` acepta `categoryId`, `available`, `excludeAllergens` (códigos
separados por coma), `q`, `page` y `size` (máximo 100). Solo devuelve platillos activos de
categorías activas.

### Administración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/menu/admin/categories` | Todas las categorías |
| POST | `/api/menu/admin/categories` | Crea una categoría |
| PUT | `/api/menu/admin/categories/{id}` | Edita nombre y orden |
| PATCH | `/api/menu/admin/categories/{id}/status` | Activa o desactiva |
| DELETE | `/api/menu/admin/categories/{id}` | Borra una categoría sin platillos |
| GET | `/api/menu/admin/items` | Todos los platillos, paginados |
| POST | `/api/menu/admin/items` | Crea un platillo en borrador |
| PUT | `/api/menu/admin/items/{id}` | Edita un platillo; exige `revision` |
| PUT | `/api/menu/admin/items/{id}/allergens` | Reemplaza alérgenos y marca revisión |
| PATCH | `/api/menu/admin/items/{id}/status` | Activa o desactiva con `revision` |
| PUT | `/api/menu/admin/items/{id}/photo` | Sube o reemplaza la foto (`multipart/form-data`, campo `file`) |
| DELETE | `/api/menu/admin/items/{id}/photo` | Quita la foto |

### Simulador de Inventory (solo etapa A)

| Método | Ruta | Descripción |
|---|---|---|
| PUT | `/api/menu/dev/items/{id}/availability` | Simula `MenuItemAvailabilityChanged`; exige `admin` |

El simulador solo existe si `DEV_TOOLS_ENABLED=true`. En modo integrado la ruta responde
404. Acepta `available` y, opcionalmente, `occurredAt` (ISO-8601). Devuelve `applied`,
`duplicate` o `stale`; la disponibilidad no sube `revision` ni publica eventos.

Reglas principales de la etapa:

- Editar nombre, precio o categoría sube `revision` y publica `MenuItemUpdated`. Editar
  descripción, `japaneseName`, orden o foto no lo hace.
- Renombrar una categoría sube la revisión de todos sus platillos y publica un evento por
  cada uno con el mismo `correlationId`.
- No se puede desactivar una categoría con platillos activos ni borrar una que haya tenido
  platillos.
- Un platillo activo no puede moverse a una categoría inactiva.
- Las fotos aceptan JPEG, PNG o WebP de hasta 5 MB, validadas por contenido. Se guarda una
  foto por platillo con nombre generado; al reemplazarla cambia la URL.

## Flujo de ejemplo

```bash
BASE=http://localhost:3000/api/menu
AUTH='Authorization: Bearer dev-admin-token'

CAT_ID=$(curl -s -X POST "$BASE/admin/categories" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"Pruebas","displayOrder":99}' | jq -r '.id')

ITEM_ID=$(curl -s -X POST "$BASE/admin/items" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CAT_ID\",\"name\":\"Platillo de prueba\",\"description\":\"Walking skeleton\",\"priceCents\":12345,\"displayOrder\":1}" \
  | jq -r '.id')

# Falla con 422: falta revisar alérgenos
curl -s -X PATCH "$BASE/admin/items/$ITEM_ID/status" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}'

curl -s -X PUT "$BASE/admin/items/$ITEM_ID/allergens" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"allergenCodes":["pescado","soya"]}'

# Activa y sube revision a 2
curl -s -X PATCH "$BASE/admin/items/$ITEM_ID/status" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}'

# Edita el precio: sube revision a 3
curl -s -X PUT "$BASE/admin/items/$ITEM_ID" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"revision":2,"priceCents":13900}'

# Sube una foto
curl -s -X PUT "$BASE/admin/items/$ITEM_ID/photo" \
  -H "$AUTH" -F 'file=@foto.png;type=image/png'

curl -s "$BASE/items?q=Platillo" | jq
curl -s "$BASE" | jq
```

Cada creación, activación, edición publicable y renombre escribe una fila en el Outbox
dentro de la misma transacción:

```bash
docker compose exec menu-db psql -U menu -d menu \
  -c "select seq, type, payload->>'revision' as revision, payload->>'active' as active, published_at from outbox_event order by seq;"
```

## Mensajería (Hito 3)

Menu publica `MenuItemUpdated` en el exchange `hachi.events` con routing key
`menu.menu-item-updated`. El relay lee el Outbox en orden de `seq`, valida el contrato con
AJV, publica con confirmación del broker y marca `published_at`; si falla, registra
`attempts`/`last_error` y reintenta con espera creciente sin avanzar al siguiente evento.
La entrega es **at-least-once** y los consumidores son idempotentes.

Topología de consumo:

| Elemento | Nombre |
|---|---|
| Exchange de eventos | `hachi.events` (topic) |
| Exchange de descarte | `hachi.dlx` (direct) |
| Cola de disponibilidad | `menu.inventory-events` |
| Routing key consumida | `inventory.menu-item-availability-changed` |
| Colas de reintento | `menu.inventory-events.retry.{1,2,3}` (TTL 5 s, 15 s, 45 s) |
| Exchange de reintento | `hachi.retry` (direct) |
| Cola de mensajes agotados | `menu.inventory-events.dlq` |

El consumidor valida el sobre y el payload. Un contrato inválido va directo a la DLQ. Un
platillo desconocido se registra y se confirma; una disponibilidad con `occurredAt` menor o
igual a `available_updated_at` se descarta como vieja. Los errores transitorios se
reprograman en la cola de reintento correspondiente; después de `CONSUMER_MAX_RETRIES`
intentos el mensaje va a la DLQ. La actualización de disponibilidad y el registro en
`processed_message` ocurren en la misma transacción.

Los TTL de las colas de reintento se pueden ajustar con `RABBITMQ_RETRY_TTLS_MS` (tres
enteros en milisegundos separados por coma). Los valores por defecto son `5000,15000,45000`;
las pruebas de integración los reducen para no esperar minutos.

El relay del Outbox usa un **lease en la base de datos** (D-48) para que una sola
instancia publique a la vez y se conserve el orden por `seq`, incluso con varias réplicas.
`OUTBOX_RELAY_LOCK_ENABLED=true` (por defecto) activa el bloqueo; `OUTBOX_RELAY_LEASE_MS`
(15 s por defecto) es su vigencia y se renueva antes de cada evento; si una instancia cae,
otra recupera el lease al expirar. `OUTBOX_RELAY_INSTANCE_ID` permite fijar el identificador
del publicador (por defecto se deriva de host, pid y un sufijo aleatorio). Con el bloqueo
deshabilitado se asume una sola instancia: dos procesos publicarían los mismos eventos.

Inspección local:

```bash
docker compose exec rabbitmq rabbitmqctl list_queues name messages
```

El simulador de Inventory permite probar el flujo sin publicar a RabbitMQ:

```bash
curl -s -X PUT "$BASE/dev/items/$ITEM_ID/availability" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"available":false}'
```

## Observabilidad y operación (Hito 4)

`GET /metrics` expone métricas en formato Prometheus con
[`@prometheus-io/client`](https://github.com/prometheus/client_js). Queda fuera del prefijo
`/api`, no pasa por autenticación y se desactiva con `METRICS_ENABLED=false` (responde 404),
así que debe publicarse solo en la red interna. Cubre:

| Grupo | Métricas |
|---|---|
| Outbox | `menu_outbox_pending_events`, `menu_outbox_relay_published_total`, `menu_outbox_relay_failures_total`, `menu_outbox_relay_cycle_errors_total` |
| Lease del relay | `menu_outbox_relay_lease_held`, `menu_outbox_relay_lease_acquisitions_total` |
| Consumidor | `menu_availability_consumer_processed_total{status}`, `menu_availability_consumer_failures_total`, `menu_availability_consumer_retries_total`, `menu_availability_consumer_dead_letters_total{reason}`, `menu_availability_consumer_duration_seconds{status}` |
| Colas | `menu_availability_queue_messages{queue}`, consultada de forma pasiva cada `QUEUE_METRICS_INTERVAL_MS` |

```bash
curl -s http://localhost:3000/metrics | grep menu_outbox
```

Las reglas de alerta (DLQ con mensajes, Outbox atascado, relay sin lease, fallos del
consumidor) están en [`ops/prometheus/alerts.yml`](ops/prometheus/alerts.yml) y el
procedimiento de triaje en [`docs/runbook-operacion.md`](docs/runbook-operacion.md).

Para recuperar mensajes descartados:

```bash
pnpm replay:dlq -- --dry-run --limit 10   # inspecciona sin publicar
pnpm replay:dlq -- --limit 100            # los devuelve a hachi.events
```

El replay conserva el `messageId` (el consumidor es idempotente), reinicia `x-retry-count` y
deduce la routing key original de `x-death`.

Trazas: no hay colector todavía, pero el relay publica cada evento con un `traceparent` W3C
nuevo y el consumidor lo continúa al reprogramar un reintento. Ambos registran
`correlationId`, `traceId` y `spanId` en los logs, así que un cambio de disponibilidad se
puede seguir de extremo a extremo con ese `correlationId`.

## Pruebas

```bash
pnpm test              # unitarias: dominio, semilla, contratos, relay, consumidor y JWT
pnpm test:integration  # integración con Testcontainers (PostgreSQL y RabbitMQ reales)
pnpm typecheck         # TypeScript estricto
pnpm build             # Compilación
```

`pnpm test:integration` requiere Docker en ejecución. Compila las pruebas con
`tsconfig.integration.json` y ejecuta el runner nativo de Node sobre contenedores
efímeros. Cubre:

- Relay del Outbox: publicación real a `hachi.events`, orden y `published_at`.
- Consumidor de disponibilidad: aplicado, duplicado, descarte por `occurredAt` viejo y
  platillo desconocido.
- Contrato inválido → DLQ.
- Reintentos con TTL creciente (`RABBITMQ_RETRY_TTLS_MS` reducido) y caída final en la DLQ.
- Bloqueo del relay multi-instancia: exclusión del lease, relevo al expirar y publicación de
  cada evento exactamente una vez con dos relays concurrentes (D-48).
- Observabilidad: `GET /metrics` fuera de `/api`, métricas registradas y estado real del lease
  y de la profundidad de colas (D-49).
- Replay de la DLQ: `--dry-run` no consume y el replay devuelve el mensaje a la cola de
  disponibilidad (D-50).
- JWT RS256: 401 sin token/expirado/firma ajena, 403 sin rol, 201 con `admin`, roles en
  `realm_access` y 404 de las herramientas `dev` en modo integrado.

No requiere Inventory ni Identity: usan los contratos provisionales descritos en
[`contracts/README.md`](contracts/README.md). Para implementar Inventory, el traspaso
autocontenido está en [`docs/integracion-inventario.md`](docs/integracion-inventario.md).

### Verificación de humo

Los dos scripts comparten los helpers de `scripts/lib/smoke-common.sh`, aceptan `--help` y se
eligen según lo que quieras comprobar:

| Script | Cuándo usarlo | Requiere |
|---|---|---|
| `./scripts/smoke.sh` | API y flujos de la etapa A: autenticación, categorías, platillos y revisiones, fotos y ETag, simulador de disponibilidad, menú público, reglas RN-06 y Outbox. | Servicio en etapa A (`AUTH_MODE=dev`, `DEV_TOOLS_ENABLED=true`) y `docker compose` para la comprobación del Outbox. |
| `./scripts/smoke-messaging.sh` | Consumidor RabbitMQ real: disponibilidad aplicada, idempotencia, mensajes viejos, DLQ por contrato inválido y replay en `--dry-run`. | Lo anterior con `OUTBOX_PUBLISH_ENABLED=true` y `CONSUMERS_ENABLED=true`, más `docker compose --profile messaging up -d rabbitmq`. |

```bash
./scripts/smoke.sh                 # no necesita RabbitMQ
./scripts/smoke-messaging.sh       # con el broker y el consumidor activos
```

Ambos aceptan `BASE_URL`; el segundo también `RABBITMQ_URL`.

Las pruebas unitarias usan un shim de Jest para `@nestjs/common` porque NestJS 12 publica
ESM puro; el runtime de la aplicación no usa ese shim. Las de integración compilan a
CommonJS y aprovechan que Node 22.12+ puede requerir ESM nativamente.

### Integración continua

GitHub Actions (`.github/workflows/ci.yml`) ejecuta en cada push a `main` y en cada pull
request tres jobs: **calidad** (typecheck, unitarias y build), **integración**
(Testcontainers con PostgreSQL y RabbitMQ reales) e **imagen Docker** (build, sin publicar).
Usa Node 22 (`.nvmrc`) y `pnpm` fijado por `packageManager`.

Para reproducir el pipeline en local:

```bash
pnpm verify              # prisma generate + typecheck + unitarias + build
pnpm test:integration    # requiere Docker
docker build -t hachi-hashi-menu:ci .
```

El paso a la etapa B (modo integrado) está detallado en
[`docs/checklist-etapa-b.md`](docs/checklist-etapa-b.md).

## Estructura

```
src/
  catalog/
    domain/          # entidades y reglas RN, sin Nest ni Prisma
    application/     # puertos, casos de uso y vistas públicas
    infrastructure/  # Prisma, Outbox, reloj, IDs, correlación y fotos
    api/             # controllers, DTOs y mappers
  common/            # problem+json, auth dev/JWT, ETag y correlation-id
  config/            # esquema de entorno y protecciones de arranque
  events/            # contrato, constructor y validador AJV
  messaging/         # relay del Outbox (con lease), adaptadores RabbitMQ y contrato consumido
  observability/     # métricas Prometheus, correlación de trazas y endpoint /metrics
  seed/              # semilla idempotente y exportación de IDs
contracts/           # esquemas de eventos y IDs semilla
docs/                # diseño, decisiones de implementación y runbook de operación
ops/                 # reglas de Prometheus para el despliegue
bruno/               # colección de flujos principales
```

## Comandos útiles

| Comando | Descripción |
|---|---|
| `pnpm start:dev` | Desarrollo con recarga |
| `pnpm build` | Compila a `dist/` |
| `pnpm db:migrate` | Crea/aplica migraciones en desarrollo |
| `pnpm db:deploy` | Aplica migraciones (contenedores/CI) |
| `pnpm seed` | Ejecuta la semilla manualmente |
| `pnpm seed:ids` | Regenera `contracts/seed/menu-item-ids.json` |
| `pnpm dev:jwt` | Genera claves RSA y firma un JWT para `AUTH_MODE=jwt` |
| `pnpm dev:publish-availability` | Publica `MenuItemAvailabilityChanged` (simulador de Inventory) |
| `pnpm replay:dlq` | Reprograma mensajes de la DLQ (`--dry-run`, `--limit`) |
| `./scripts/smoke.sh` | Humo de la API y de los flujos de la etapa A |
| `./scripts/smoke-messaging.sh` | Humo del consumidor RabbitMQ real y la DLQ |
| `pnpm test:integration` | Pruebas de integración con Testcontainers |
| `pnpm db:reset` | Reinicia la base y reaplica migraciones |
| `docker compose --profile messaging up -d rabbitmq` | Levanta RabbitMQ para el Hito 3 |
