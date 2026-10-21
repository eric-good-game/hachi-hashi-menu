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

## Ambigüedades que siguen abiertas

| Tema | Estado |
|---|---|
| Claims y roles exactos del JWT de Identity | Pendiente de contrato con Identity. Se implementará en el Hito 3. |
| Distribución de la clave pública (configuración vs JWKS) | Propuesta: configuración (`JWT_PUBLIC_KEY`/`JWT_PUBLIC_KEY_FILE`). Confirmar con Identity. |
| Nombres definitivos de exchanges, colas y DLQ | Se usan los del documento (`hachi.events`, `menu.inventory-events`, `hachi.dlx`); dependen de la decisión global de arquitectura. |
| Payload final de `MenuItemAvailabilityChanged` | Se asume `menuItemId` + `available`; se confirma al documentar Inventory. |
| Publicación de UUID semilla de platillos | Resuelto: se publican en `contracts/seed/menu-item-ids.json` y una prueba unitaria impide que el archivo se desincronice de la semilla. |

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
- Hito 3: relay del Outbox, RabbitMQ, consumidor de disponibilidad, JWT real, contratos validados con AJV.
- Hito 4: pruebas de integración con Testcontainers, CI/CD y checklist de etapa B.

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

- Hito 3: relay del Outbox, RabbitMQ, consumidor de disponibilidad, JWT real y validación de contratos con AJV.
- Hito 4: pruebas de integración con Testcontainers, CI/CD y checklist de etapa B.
- Optimización de listados con proyecciones SQL específicas si el volumen lo exige.
- Limpieza automática de fotos huérfanas (hoy solo se borra la anterior después del commit).
