# Decisiones de implementación — Menu/Catalog

Este documento registra las decisiones tomadas al implementar el servicio cuando el
documento de diseño dejaba margen de interpretación. El documento
[`Hachi Hashi servicio Menu Catalog.md`](./Hachi%20Hashi%20servicio%20Menu%20Catalog.md)
sigue siendo la fuente principal; aquí solo se resuelven ambigüedades y se anota el
alcance entregado por hito.

## Decisiones tomadas

| # | Tema | Decisión | Motivo |
|---|---|---|---|
| D-01 | `revision` y campos no publicables | `revision` sube **solo** con cambios publicables: nombre, precio, categoría, `active` y renombre de la categoría. Descripción, orden, foto y `japaneseName` no la modifican. | El contrato de `MenuItemUpdated` define `revision` como la versión del estado publicado; los consumidores solo necesitan ordenar eventos. |
| D-02 | Concurrencia en campos no publicables | Las escrituras no publicables usan `revision` como comprobación de existencia, pero no la incrementan. Dos ediciones simultáneas de descripción/orden se resuelven con last-write-wins. | Evita publicar eventos y subir revisión por datos que no viajan en el contrato. Se acepta el riesgo porque no afectan a otros servicios. |
| D-03 | `PUT .../allergens` sin `revision` | El endpoint no exige `revision`. Marca `allergens_reviewed=true` y no publica evento. | Así está definido en la API del documento. La activación posterior vuelve a leer el estado actual dentro de su transacción. |
| D-04 | `japaneseName` | Se acepta al crear el platillo y se edita en el `PUT` de administración. No sube `revision` ni publica evento. | Es texto de apoyo para mostrar; no forma parte del payload de eventos. |
| D-05 | Crear platillo publica evento | Sí: un `MenuItemUpdated` con `revision=1` y `active=false`. | El documento lo exige explícitamente. Los consumidores deben aceptar borradores y filtrar por `active`. |
| D-06 | Renombrar categoría | Genera un evento por platillo de la categoría —incluidos borradores e inactivos—, todos con el mismo `correlationId`, en una sola transacción. | Es lo que define la sección 4.1. Implementado en el Hito 2. |
| D-07 | Slug de categoría | Se genera desde el nombre al crear (slugify, locale es). Es editable por el cliente y **no** se recalcula al renombrar. | Evitar romper URLs públicas. |
| D-08 | Activación con categoría inactiva | Devuelve **422** con código `RN-06`. | Una categoría inactiva no puede tener platillos activos (RN-06). |
| D-09 | `allergens_reviewed` | Es monótono: una vez `true`, no vuelve a `false`, ni siquiera si se reemplaza la lista por una vacía. | Distingue “sin alérgenos” de “sin capturar” (RN-03). |
| D-10 | Disponibilidad inicial | Todo platillo nace con `available=true`, incluso en borrador. | Es el valor por defecto del modelo; el menú público solo muestra activos. |
| D-11 | Códigos de alérgenos | Son ASCII (`crustaceos`, `lacteos`, `ajonjoli`, `frutos-secos`) y los nombres llevan acentos. | Evitar problemas de codificación en URLs, filtros y eventos. |
| D-12 | Moneda | `MXN` fija; no se acepta otra moneda en la API de esta etapa. | Convención de dinero en centavos definida en el documento. |
| D-13 | Fotos | Disco local con volumen Docker, detrás de `PhotoStoragePort`. Una foto por platillo, nombre generado por el servicio (`UUID.ext`). | Decisión del equipo; permite migrar a object storage sin tocar negocio. |
| D-14 | Caché pública | `ETag` fuerte calculado sobre el JSON y `Cache-Control: public, max-age=60`; `If-None-Match` devuelve 304. | RN-11. |
| D-15 | Categorías vacías en el menú público | Se incluyen las categorías activas aunque no tengan platillos. | El menú representa la estructura vigente; el cliente puede ocultarlas si lo desea. |
| D-16 | Paginación de administración | `page` empieza en 1; `size` por defecto 20 y máximo 100. | Convención común de listados. |
| D-17 | Reintentos del consumidor (Hito 3) | Cola de reintento con TTL y dead-letter a la cola principal; tras 3 intentos, DLQ. No se asume el plugin de mensajes retardados. | Funciona con RabbitMQ estándar. |
| D-18 | UUID semilla | UUID v5 deterministas con namespace fijo; los 30 platillos semilla se publican en `contracts/seed/menu-item-ids.json`. | Inventory puede reutilizar los IDs sin depender de Menu. |
| D-19 | Salud | `/health` solo comprueba la base; no exige RabbitMQ. | El documento define salud del servicio y su base. |
| D-20 | Modo `dev` de autenticación | Tokens fijos `dev-admin-token` y `dev-viewer-token`; sin token 401, con rol insuficiente 403. | Permite probar la API completa sin Identity en la etapa A. |
| D-21 | Banderas de hitos posteriores | En los Hitos 1 y 2, `AUTH_MODE=jwt`, `OUTBOX_PUBLISH_ENABLED=true` y `CONSUMERS_ENABLED=true` hacen fallar el arranque con un mensaje explícito. | Evita arrancar con funcionalidad que aún no existe y creer que los eventos se publican o que los mensajes se consumen. |
| D-22 | Edición de platillo | `PUT /admin/items/{id}` exige `revision` y solo sube revisión/publica evento por nombre, precio o categoría. Los cambios de descripción, `japaneseName` y orden no publican. Una edición sin cambios devuelve el estado actual sin tocar la base. | Coherente con D-01 y RN-07/RN-08. |
| D-23 | Mover platillo de categoría | Se valida unicidad de nombre en la categoría destino. Un platillo activo no puede moverse a una categoría inactiva: 422 `RN-06`. Un borrador sí puede. | Mantiene el invariante de RN-06 sin impedir preparar borradores. |
| D-24 | Estado de categoría | Desactivar exige que no haya platillos activos (409 `RN-06`). Activar no exige nada. No publica eventos. | La categoría no forma parte del contrato de eventos; sus platillos ya reflejan su estado. |
| D-25 | Borrado de categoría | Solo se permite si la categoría nunca tuvo platillos (`count = 0`); si tuvo, 409 `RN-06`. Es borrado físico. | No hay borrado de platillos (RN-05), así que el historial de la categoría se conserva. |
| D-26 | Renombre y revisión | El renombre sube la revisión de todos los platillos de la categoría, incluso inactivos y borradores, y publica un evento por cada uno con el mismo `correlationId`. | El nombre de categoría viaja en el payload; cualquier platillo puede cambiar de versión publicada. |
| D-27 | Validación de fotos | Se valida por bytes mágicos (JPEG, PNG, WebP), no por extensión ni `Content-Type`; máximo 5 MB. Un archivo inválido o demasiado grande devuelve 400. El nombre se genera con UUID y la foto anterior se borra después del commit. | RN-10 y evitar confiar en datos del cliente. Si falla el borrado del archivo viejo, la base ya quedó consistente. |
| D-28 | Foto y revisión | Subir o quitar foto actualiza `updated_at`/`updated_by` pero no sube `revision` ni publica evento. | La foto no viaja en el evento; el cliente la resuelve por `photoUrl`. |
| D-29 | Listado público de platillos | Solo incluye platillos activos de categorías activas. Filtros: `categoryId`, `available`, `excludeAllergens` (excluye si tiene cualquiera de los códigos), `q` (nombre, descripción o nombre japonés). Orden por categoría, orden y nombre; `page` desde 1, `size` máximo 100. | Cubre la consulta del menú sin exponer borradores. |
| D-30 | Detalle público y medios | `GET /items/{id}` devuelve 404 si el platillo o su categoría no están activos. Las fotos se sirven con ETag basado en el nombre del archivo y `Cache-Control: public, max-age=60`; al reemplazar la foto cambia la URL. | RN-11 y caché segura: el contenido de una URL no cambia. |
| D-31 | Semilla de platillos | 30 platillos distribuidos en las 7 categorías, con UUID v5, alérgenos revisados y `active=true`. La semilla no sobrescribe cambios: busca por ID y, para categorías, por slug o nombre; si ya existe, no crea. | Permite arrancar con un menú demostrable y mantiene idempotencia aun después de renombrar una categoría. |
| D-32 | Banderas del Hito 3 | Se sustituye la protección de D-21: `AUTH_MODE=jwt`, `OUTBOX_PUBLISH_ENABLED` y `CONSUMERS_ENABLED` ya están implementados. El arranque falla si el relay/consumidor no tienen `RABBITMQ_URL` o si `AUTH_MODE=jwt` no tiene clave pública. | Las banderas ahora activan funcionalidad real; la validación evita configuraciones incompletas. |
| D-33 | Relay del Outbox | Un solo proceso lee lotes ordenados por `seq`, valida el contrato, publica con publisher confirms y marca `published_at`. Ante un fallo registra `attempts`/`last_error` y aplica backoff exponencial (desde `OUTBOX_POLL_INTERVAL_MS` hasta 30 s) sin avanzar al siguiente evento. La entrega es at-least-once. | Conserva el orden y tolera caídas del broker; los consumidores deben ser idempotentes. No hay bloqueo multi-instancia en esta etapa. |
| D-34 | Topología RabbitMQ | `hachi.events` (topic) para publicar; `hachi.dlx` (direct) para descartes; `hachi.retry` (direct) para reintentos; cola `menu.inventory-events`; routing key `inventory.menu-item-availability-changed`; DLQ `menu.inventory-events.dlq`. | Usa los nombres del documento y no exige plugins de RabbitMQ. |
| D-35 | Reintentos y DLQ | Los fallos transitorios se publican en `menu.inventory-events.retry.{1,2,3}` con TTL de 5 s, 15 s y 45 s; cada cola dead-lettera de vuelta a `hachi.events`. Tras `CONSUMER_MAX_RETRIES` intentos el mensaje va a la DLQ. Un contrato inválido va directo a la DLQ. | Backoff sin plugin de mensajes retardados y descarte observable de mensajes irrecuperables. |
| D-36 | Consumidor de disponibilidad | La actualización de `available`/`available_updated_at` y el registro en `processed_message` van en la misma transacción. Un `messageId` repetido se ignora; un platillo desconocido se registra y se confirma; un `occurredAt` menor o igual al actual se descarta como viejo. No sube `revision` ni publica eventos. | RN-09 e idempotencia ante entregas at-least-once. |
| D-37 | Autenticación JWT | Se valida RS256 con clave pública en `JWT_PUBLIC_KEY` o `JWT_PUBLIC_KEY_FILE`. El claim `sub` es obligatorio; los roles se leen de `roles` o de `realm_access.roles`. Sin token/inválido: 401; sin rol: 403. No se consulta JWKS ni se valida issuer/audience en esta etapa. | Contrato mínimo con Identity; el algoritmo y la distribución de clave quedan explícitos. |
| D-38 | Validación de contratos | Se usa AJV draft 2020-12 con `ajv-formats` para validar `MenuItemUpdated` antes de publicar y `MenuItemAvailabilityChanged` antes de consumir. Los esquemas y ejemplos viven en `contracts/` y se copian a la imagen Docker. | Detecta payloads incompatibles en el borde del sistema, no solo en pruebas. |
| D-39 | Simulador de disponibilidad | `PUT /api/menu/dev/items/{id}/availability` exige rol `admin`, solo existe con `DEV_TOOLS_ENABLED=true` y devuelve `applied`, `duplicate` o `stale`. En modo integrado responde 404. | Permite probar la etapa A sin Inventory ni RabbitMQ. No sustituye al consumidor real. |
| D-40 | Salud y observabilidad | `/health` sigue comprobando solo PostgreSQL; RabbitMQ no es requisito para el health. El relay y el consumidor registran conexión, reintentos, descartes y resultados. | Un broker caído no debe tumbar el servicio; el relay reintenta y el consumidor se reconecta. |
| D-41 | RabbitMQ local | Se añade al compose con el perfil `messaging`; no se levanta con el comando por defecto. | Mantiene el arranque de la etapa A ligero y permite probar el Hito 3 con un comando explícito. |
| D-42 | Contratos provisionales | `MenuItemUpdated` queda estable para la etapa A; `MenuItemAvailabilityChanged` queda marcado como **provisional** porque Inventory no existe. Se documenta el checklist de confirmación en `contracts/README.md`. | Evita tratar supuestos como acuerdos cerrados y deja explícito qué validar al integrar Inventory/Identity. |
| D-43 | TTL de reintento configurables | Las colas usan `RABBITMQ_RETRY_TTLS_MS` (tres enteros en ms, por defecto `5000,15000,45000`). La topología conserva los nombres de D-34; solo cambia el TTL. | Permite que las pruebas de integración ejerciten los tres reintentos sin esperar más de un minuto. |
| D-44 | Simuladores de desarrollo | `scripts/dev-inventory-publisher.cjs` publica `MenuItemAvailabilityChanged` al exchange real y `scripts/dev-jwt.cjs` genera claves RSA y firma un JWT RS256. | Cierran la brecha de pruebas del Hito 3 sin depender de Inventory ni Identity; no sustituyen a los servicios reales. |
| D-45 | Pruebas de integración | Se usa Testcontainers con PostgreSQL 16 y RabbitMQ 3.13, migraciones Prisma reales y el runner nativo de Node (`node:test`). `pnpm test:integration` compila con `tsconfig.integration.json` y ejecuta en serie. | Evita el problema de Jest con el ESM de NestJS 12 y cubre relay, consumidor, idempotencia, `occurredAt` viejo, DLQ, reintentos y JWT contra infraestructura real. |
| D-46 | Relay multi-instancia | Se mantiene una sola instancia del relay en el Hito 3 (coherente con D-33); no se implementa bloqueo distribuido. | El bloqueo/particionado se evaluará en el Hito 4 con carga real; documentarlo es suficiente para la etapa A. |

## Ambigüedades que siguen abiertas

| Tema | Estado |
|---|---|
| Claims y roles exactos del JWT de Identity | Parcialmente resuelto en D-37 (`sub`, `roles` y `realm_access.roles`). Falta confirmar el contrato definitivo con Identity. |
| Distribución de la clave pública (configuración vs JWKS) | Resuelto para esta etapa por configuración (`JWT_PUBLIC_KEY`/`JWT_PUBLIC_KEY_FILE`); JWKS queda diferido. |
| Nombres definitivos de exchanges, colas y DLQ | Se usan los del documento y D-34: `hachi.events`, `menu.inventory-events`, `hachi.dlx`, `hachi.retry` y `menu.inventory-events.dlq`. |
| Payload final de `MenuItemAvailabilityChanged` | Se asume `menuItemId` + `available` y se valida con `contracts/menu-item-availability-changed.v1.schema.json`; se confirma al documentar Inventory. |
| Publicación de UUID semilla de platillos | Resuelto: se publican en `contracts/seed/menu-item-ids.json` y una prueba unitaria impide que el archivo se desincronice de la semilla. |
| Relay multi-instancia | Resuelto para esta etapa en D-46: se asume una sola instancia; el bloqueo/particionado se evalúa en el Hito 4. |
| Reintentos del consumidor | Resuelto en D-35: tres colas con TTL creciente y DLQ; no se usa el plugin de mensajes retardados. El TTL es configurable con `RABBITMQ_RETRY_TTLS_MS` (D-43). |
| Contrato de `MenuItemUpdated` y disponibilidad | El evento no incluye `available`; la disponibilidad llega por Inventory y no incrementa `revision`. Confirmado para esta etapa. |

## Alcance del Hito 1 (walking skeleton)

Incluido:

- Proyecto NestJS + Prisma + PostgreSQL con migración inicial.
- Configuración validada con zod y protecciones de arranque de la sección 7.
- Semilla idempotente de alérgenos y 7 categorías con UUID deterministas.
- Dominio de `Category` y `MenuItem` con RN-01, RN-02, RN-03, RN-05, RN-06, RN-07 y RN-08.
- Outbox transaccional en creación y activación de platillos.
- API pública `GET /api/menu`, `GET /api/menu/categories`, `GET /api/menu/allergens` con ETag.
- API de administración para crear categoría, crear platillo, reemplazar alérgenos, activar/desactivar y listar.
- Autenticación de desarrollo, roles y errores `application/problem+json`.
- Swagger en `/api/docs`, health, Dockerfile, compose, pruebas unitarias, colección Bruno y script de humo.

Diferido a hitos posteriores:

- Hito 2: completado; incluye edición de platillo, estado y borrado de categoría, fotos, reglas RN-04/RN-10/RN-11, semilla de 30 platillos y publicación de sus IDs.
- Hito 3: completado; incluye relay del Outbox, RabbitMQ, consumidor de disponibilidad, JWT real y contratos validados con AJV.
- Hito 4: CI/CD y checklist de etapa B (las pruebas de integración con Testcontainers se adelantaron al cierre del Hito 3, D-45).

## Alcance del Hito 2

Incluido:

- `PUT /api/menu/admin/items/{id}` con control de revisión, validación de unicidad en la categoría destino y bloqueo de movimiento de un platillo activo a una categoría inactiva.
- `PUT /api/menu/admin/categories/{id}`, `PATCH /api/menu/admin/categories/{id}/status` y `DELETE /api/menu/admin/categories/{id}` con las reglas RN-06.
- Renombre de categoría transaccional con publicación de un evento por platillo y el mismo `correlationId`.
- Fotos en disco local: `PUT` y `DELETE /api/menu/admin/items/{id}/photo`, servicio `GET /api/menu/media/{file}` con ETag, validación por bytes mágicos y límite de 5 MB.
- Consulta pública paginada `GET /api/menu/items` con filtros y detalle `GET /api/menu/items/{id}`.
- Semilla de 30 platillos con UUID deterministas y contrato `contracts/seed/menu-item-ids.json`.
- Pruebas unitarias adicionales y script de humo ampliado con edición, renombre, fotos, reglas de categoría y Outbox.

Diferido:

- Hito 3: completado; incluye relay del Outbox, RabbitMQ, consumidor de disponibilidad, JWT real y validación de contratos con AJV.
- Hito 4: CI/CD y checklist de etapa B (las pruebas de integración con Testcontainers se adelantaron al cierre del Hito 3, D-45).
- Optimización de listados con proyecciones SQL específicas si el volumen lo exige.
- Limpieza automática de fotos huérfanas (hoy solo se borra la anterior después del commit).

## Alcance del Hito 3

Incluido:

- Relay del Outbox con orden por `seq`, publisher confirms, backoff exponencial y registro de intentos/errores.
- Topología RabbitMQ completa: exchange de eventos, DLX, exchange/colas de reintento, DLQ y cola de disponibilidad.
- Consumidor de `MenuItemAvailabilityChanged` con validación de contrato, idempotencia transaccional, descarte de mensajes viejos, confirmación de platillos desconocidos y reintentos con TTL.
- Autenticación JWT RS256 con clave pública por configuración o archivo, roles y sustitución del guard de desarrollo en administración.
- Validación AJV de eventos publicados y consumidos, con esquemas y ejemplos versionados en `contracts/`.
- Simulador de disponibilidad para la etapa A, limitado a `DEV_TOOLS_ENABLED=true` y rol `admin`.
- Pruebas unitarias de contratos, relay, consumidor, JWT y configuración (55 en total); script de humo ampliado con disponibilidad.
- Perfil `messaging` en Docker Compose y copia de `contracts/` a la imagen de producción.
- Cierre de brechas de la etapa A: contratos provisionales documentados (D-42), simuladores
  `dev-inventory-publisher` y `dev-jwt` (D-44), TTL de reintento configurables (D-43),
  pruebas de integración con Testcontainers (D-45) y guion `scripts/smoke-messaging.sh`.

Diferido:

- Bloqueo o particionado del relay para múltiples instancias (D-46).
- JWKS, validación de issuer/audience y rotación automática de claves.
- Métricas, trazas y alertas del relay/consumidor; herramienta de replay de la DLQ.
- CI/CD y checklist de etapa B (Hito 4).
- Confirmación final del contrato de Identity y del payload de Inventory.
