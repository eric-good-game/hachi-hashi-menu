# Hachi Hashi — Menu/Catalog

Servicio dueño del menú del restaurante: platillos, categorías, precios, alérgenos y fotos.
Construido con NestJS, Prisma y PostgreSQL.

Este repositorio contiene los **Hitos 1 y 2**: creación y edición de platillos, revisión de
alérgenos, activación, categorías con sus reglas de estado y borrado, fotos en disco local,
consulta pública paginada, menú público con ETag y Outbox transaccional. Las decisiones
tomadas y el alcance diferido están en
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

La semilla (`SEED_ON_START=true`) carga los 11 alérgenos, las 7 categorías base y
30 platillos con UUID deterministas. Es idempotente y no sobrescribe cambios hechos por
administración. Los IDs publicados para Inventory están en
[`contracts/seed/menu-item-ids.json`](contracts/seed/menu-item-ids.json).

Para levantar todo en contenedores:

```bash
docker compose up --build
```

Las fotos se guardan en el volumen `menu-photos`, montado en `/app/var/photos`.

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

## Pruebas

```bash
pnpm test        # unitarias: dominio, semilla, contrato del evento y configuración
pnpm typecheck   # TypeScript estricto
pnpm build       # Compilación
```

Para una verificación de humo contra el servicio levantado (incluye edición, fotos,
renombre de categoría, reglas RN-06 y Outbox):

```bash
./scripts/smoke.sh
```

## Estructura

```
src/
  catalog/
    domain/          # entidades y reglas RN, sin Nest ni Prisma
    application/     # puertos, casos de uso y vistas públicas
    infrastructure/  # Prisma, Outbox, reloj, IDs, correlación y fotos
    api/             # controllers, DTOs y mappers
  common/            # problem+json, auth dev, ETag y correlation-id
  config/            # esquema de entorno y protecciones de arranque
  events/            # contrato y constructor de MenuItemUpdated
  seed/              # semilla idempotente y exportación de IDs
contracts/           # esquemas de eventos y IDs semilla
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
| `pnpm seed:ids` | Regenera `contracts/seed/menu-item-ids.json` |
| `pnpm db:reset` | Reinicia la base y reaplica migraciones |
