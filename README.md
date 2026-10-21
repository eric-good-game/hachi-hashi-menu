# Hachi Hashi — Menu/Catalog

Servicio dueño del menú del restaurante: platillos, categorías, precios, alérgenos y fotos.
Construido con NestJS, Prisma y PostgreSQL.

Este repositorio contiene el **Hito 1 (walking skeleton)**: creación de categorías y
platillos en borrador, revisión de alérgenos, activación, menú público y Outbox
transaccional. Las decisiones tomadas y el alcance diferido están en
[`docs/decisiones-implementacion-menu.md`](docs/decisiones-implementacion-menu.md).

## Requisitos

- Node.js 22 o superior
- pnpm 11
- Docker (para PostgreSQL)

## Inicio rápido

```bash
pnpm install
docker compose up -d menu-db
pnpm db:deploy
pnpm start:dev
```

El servicio queda en `http://localhost:3000`, la documentación en
`http://localhost:3000/api/docs` y la salud en `http://localhost:3000/health`.

La semilla (`SEED_ON_START=true`) carga los 11 alérgenos y las 7 categorías base con
UUID deterministas. Es idempotente.

Para levantar todo en contenedores:

```bash
docker compose up --build
```

## Autenticación de desarrollo

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

## Endpoints del Hito 1

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Salud del servicio y su base |
| GET | `/api/menu` | Menú público con ETag |
| GET | `/api/menu/categories` | Categorías activas |
| GET | `/api/menu/allergens` | Catálogo de alérgenos |
| GET | `/api/menu/admin/categories` | Todas las categorías |
| POST | `/api/menu/admin/categories` | Crea una categoría |
| GET | `/api/menu/admin/items` | Todos los platillos, paginados |
| POST | `/api/menu/admin/items` | Crea un platillo en borrador |
| PUT | `/api/menu/admin/items/{id}/allergens` | Reemplaza alérgenos y marca revisión |
| PATCH | `/api/menu/admin/items/{id}/status` | Activa o desactiva con `revision` |

## Flujo del walking skeleton

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

curl -s "$BASE" | jq
```

Cada creación y activación escribe una fila en el Outbox dentro de la misma transacción:

```bash
docker compose exec menu-db psql -U menu -d menu \
  -c "select seq, type, payload->>'revision' as revision, payload->>'active' as active, published_at from outbox_event order by seq;"
```

## Pruebas

```bash
pnpm test        # unitarias: dominio, contrato del evento y configuración
pnpm typecheck   # TypeScript estricto
```

Para una verificación de humo contra el servicio levantado:

```bash
./scripts/smoke.sh
```

## Estructura

```
src/
  catalog/
    domain/          # entidades y reglas RN, sin Nest ni Prisma
    application/     # puertos y casos de uso
    infrastructure/  # Prisma, Outbox, reloj, IDs y correlación
    api/             # controllers, DTOs y mappers
  common/            # problem+json, auth dev, ETag y correlation-id
  config/            # esquema de entorno y protecciones de arranque
  events/            # contrato y constructor de MenuItemUpdated
  seed/              # semilla idempotente
contracts/           # esquemas JSON de eventos
docs/                # diseño y decisiones de implementación
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
| `pnpm db:reset` | Reinicia la base y reaplica migraciones |
