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
| D-04 | `japaneseName` | Se acepta al crear el platillo y se editará en el `PUT` de administración del Hito 2. No sube `revision` ni publica evento. | Es texto de apoyo para mostrar; no forma parte del payload de eventos. |
| D-05 | Crear platillo publica evento | Sí: un `MenuItemUpdated` con `revision=1` y `active=false`. | El documento lo exige explícitamente. Los consumidores deben aceptar borradores y filtrar por `active`. |
| D-06 | Renombrar categoría | Genera un evento por platillo de la categoría, todos con el mismo `correlationId`, en una sola transacción. | Es lo que define la sección 4.1. Se implementará en el Hito 2. |
| D-07 | Slug de categoría | Se genera desde el nombre al crear (slugify, locale es). Es editable por el cliente y **no** se recalcula al renombrar. | Evitar romper URLs públicas. |
| D-08 | Activación con categoría inactiva | Devuelve **422** con código `RN-06`. | Una categoría inactiva no puede tener platillos activos (RN-06). |
| D-09 | `allergens_reviewed` | Es monótono: una vez `true`, no vuelve a `false`, ni siquiera si se reemplaza la lista por una vacía. | Distingue “sin alérgenos” de “sin capturar” (RN-03). |
| D-10 | Disponibilidad inicial | Todo platillo nace con `available=true`, incluso en borrador. | Es el valor por defecto del modelo; el menú público solo muestra activos. |
| D-11 | Códigos de alérgenos | Son ASCII (`crustaceos`, `lacteos`, `ajonjoli`, `frutos-secos`) y los nombres llevan acentos. | Evitar problemas de codificación en URLs, filtros y eventos. |
| D-12 | Moneda | `MXN` fija; no se acepta otra moneda en la API de esta etapa. | Convención de dinero en centavos definida en el documento. |
| D-13 | Fotos | Disco local con volumen Docker, detrás de `PhotoStoragePort`. Una foto por platillo, nombre generado por el servicio. | Decisión del equipo; permite migrar a object storage sin tocar negocio. |
| D-14 | Caché pública | `ETag` fuerte calculado sobre el JSON y `Cache-Control: public, max-age=60`; `If-None-Match` devuelve 304. | RN-11. |
| D-15 | Categorías vacías en el menú público | Se incluyen las categorías activas aunque no tengan platillos. | El menú representa la estructura vigente; el cliente puede ocultarlas si lo desea. |
| D-16 | Paginación de administración | `page` empieza en 1; `size` por defecto 20 y máximo 100. | Convención común de listados. |
| D-17 | Reintentos del consumidor (Hito 3) | Cola de reintento con TTL y dead-letter a la cola principal; tras 3 intentos, DLQ. No se asume el plugin de mensajes retardados. | Funciona con RabbitMQ estándar. |
| D-18 | UUID semilla | UUID v5 deterministas con namespace fijo; se publicarán en `contracts/seed/` cuando se siembre el catálogo de platillos (Hito 2). | Inventory puede reutilizar los IDs sin depender de Menu. |
| D-19 | Salud | `/health` solo comprueba la base; no exige RabbitMQ. | El documento define salud del servicio y su base. |
| D-20 | Modo `dev` de autenticación | Tokens fijos `dev-admin-token` y `dev-viewer-token`; sin token 401, con rol insuficiente 403. | Permite probar la API completa sin Identity en la etapa A. |
| D-21 | Banderas de hitos posteriores | En el Hito 1, `AUTH_MODE=jwt`, `OUTBOX_PUBLISH_ENABLED=true` y `CONSUMERS_ENABLED=true` hacen fallar el arranque con un mensaje explícito. | Evita arrancar con funcionalidad que aún no existe y creer que los eventos se publican o que los mensajes se consumen. |

## Ambigüedades que siguen abiertas

| Tema | Estado |
|---|---|
| Claims y roles exactos del JWT de Identity | Pendiente de contrato con Identity. Se implementará en el Hito 3. |
| Distribución de la clave pública (configuración vs JWKS) | Propuesta: configuración (`JWT_PUBLIC_KEY`/`JWT_PUBLIC_KEY_FILE`). Confirmar con Identity. |
| Nombres definitivos de exchanges, colas y DLQ | Se usan los del documento (`hachi.events`, `menu.inventory-events`, `hachi.dlx`); dependen de la decisión global de arquitectura. |
| Payload final de `MenuItemAvailabilityChanged` | Se asume `menuItemId` + `available`; se confirma al documentar Inventory. |
| Publicación de UUID semilla de platillos | Se hará en `contracts/seed/` y se copiará al repositorio de infraestructura en el Hito 2. |

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

- Hito 2: edición de platillo, estado de categorías, borrado de categoría, fotos, reglas RN-04/RN-10/RN-11 completas, semilla de ~30 platillos y publicación de sus IDs.
- Hito 3: relay del Outbox, RabbitMQ, consumidor de disponibilidad, JWT real, contratos validados con AJV.
- Hito 4: pruebas de integración con Testcontainers, CI/CD y checklist de etapa B.
