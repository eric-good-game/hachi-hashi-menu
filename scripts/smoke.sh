#!/usr/bin/env bash
set -euo pipefail

# Humo de la API y de los flujos de la etapa A, sin RabbitMQ: salud,
# autenticación, categorías, platillos, reglas RN, fotos, disponibilidad por el
# simulador de Inventory, menú público y Outbox.
#
# Uso:
#   ./scripts/smoke.sh [--help]
#
# Requiere el servicio en etapa A (AUTH_MODE=dev, DEV_TOOLS_ENABLED=true) y,
# para la comprobación del Outbox, `docker compose` levantado.
# Para el consumidor RabbitMQ real usa ./scripts/smoke-messaging.sh.
#
# Variables:
#   BASE_URL  (por defecto http://localhost:3000)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/smoke-common.sh
source "$SCRIPT_DIR/lib/smoke-common.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'TXT'
Humo de la API y de los flujos de la etapa A (sin RabbitMQ).

Uso: ./scripts/smoke.sh [--help]

Cubre: salud, autenticación (401/403), categorías, platillos, alérgenos,
revisiones, fotos y ETag, disponibilidad por el simulador de Inventory,
listado público, reglas RN-06 y los eventos del Outbox.

Requiere el servicio levantado en etapa A (AUTH_MODE=dev,
DEV_TOOLS_ENABLED=true). Para verificar el consumidor RabbitMQ real usa
./scripts/smoke-messaging.sh.

Variables:
  BASE_URL  URL base del servicio (por defecto http://localhost:3000)
TXT
  exit 0
fi

SUFFIX="$(date +%s)"
CATEGORY_NAME="Smoke $SUFFIX"
ITEM_NAME="Walking skeleton $SUFFIX"
NEW_CATEGORY_NAME="Smoke renamed $SUFFIX"

section "Salud"
require_health

section "Autenticación"
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/admin/categories" \
  -H 'Content-Type: application/json' -d '{"name":"Sin token","displayOrder":1}')
expect_status 401 "$status" "sin token"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/admin/categories" \
  -H 'Authorization: Bearer dev-viewer-token' -H 'Content-Type: application/json' \
  -d '{"name":"Sin rol","displayOrder":1}')
expect_status 403 "$status" "sin rol admin"

section "Crear categoría"
category=$(curl -s -X POST "$API/admin/categories" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$CATEGORY_NAME\",\"displayOrder\":99}")
category_id=$(echo "$category" | jq -r '.id')
[[ "$category_id" != "null" && -n "$category_id" ]] || fail "no se creó la categoría: $category"
ok "categoría $category_id"

section "Crear platillo"
item=$(curl -s -X POST "$API/admin/items" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$category_id\",\"name\":\"$ITEM_NAME\",\"description\":\"Smoke test\",\"priceCents\":12345,\"displayOrder\":1}")
item_id=$(echo "$item" | jq -r '.id')
revision=$(echo "$item" | jq -r '.revision')
[[ "$item_id" != "null" && -n "$item_id" ]] || fail "no se creó el platillo: $item"
expect_json "$revision" "1" "platillo nace con revision 1"
ok "platillo $item_id"

section "Activar sin alérgenos"
status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
expect_status 422 "$status" "activación sin alérgenos"

section "Revisar alérgenos"
allergens=$(curl -s -X PUT "$API/admin/items/$item_id/allergens" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"allergenCodes":["pescado","soya","pescado"]}')
reviewed=$(echo "$allergens" | jq -r '.allergensReviewed')
count=$(echo "$allergens" | jq '.allergens | length')
expect_json "$reviewed" "true" "alérgenos revisados"
expect_json "$count" "2" "alérgenos deduplicados"

section "Activar platillo"
activated=$(curl -s -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
expect_json "$(echo "$activated" | jq -r '.active')" "true" "platillo activo"
expect_json "$(echo "$activated" | jq -r '.revision')" "2" "activación sube a revision 2"

section "Editar platillo (Hito 2)"
updated=$(curl -s -X PUT "$API/admin/items/$item_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"revision":2,"priceCents":13900,"displayOrder":2}')
expect_json "$(echo "$updated" | jq -r '.priceCents')" "13900" "precio actualizado"
expect_json "$(echo "$updated" | jq -r '.revision')" "3" "cambio de precio sube a revision 3"

description_only=$(curl -s -X PUT "$API/admin/items/$item_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"revision":3,"description":"Smoke test actualizado"}')
expect_json "$(echo "$description_only" | jq -r '.revision')" "3" "descripción no sube la revisión"

status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$item_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"revision":2,"priceCents":15000}')
expect_status 409 "$status" "edición con revisión desactualizada"

section "Simulador de disponibilidad (Hito 3)"
availability=$(curl -s -X PUT "$API/dev/items/$item_id/availability" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"available":false,"occurredAt":"2030-01-01T00:00:00.000Z"}')
expect_json "$(echo "$availability" | jq -r '.status')" "applied" "disponibilidad aplicada"
expect_json "$(echo "$availability" | jq -r '.available')" "false" "platillo marcado agotado"

detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.available')" "false" "el detalle público refleja agotado"
admin_revision=$(curl -s "$API/admin/items?size=100" -H "$AUTH_HEADER" | jq -r --arg id "$item_id" '.items[] | select(.id == $id) | .revision')
expect_json "$admin_revision" "3" "la disponibilidad no sube la revisión"

stale=$(curl -s -X PUT "$API/dev/items/$item_id/availability" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"available":true,"occurredAt":"2029-01-01T00:00:00.000Z"}')
expect_json "$(echo "$stale" | jq -r '.status')" "stale" "disponibilidad vieja descartada"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.available')" "false" "la disponibilidad vieja no cambia el estado"

applied=$(curl -s -X PUT "$API/dev/items/$item_id/availability" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"available":true,"occurredAt":"2031-01-01T00:00:00.000Z"}')
expect_json "$(echo "$applied" | jq -r '.status')" "applied" "disponibilidad más nueva aplicada"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.available')" "true" "el detalle público vuelve a disponible"

section "Consultas públicas de platillos"
listed=$(curl -s --get --data-urlencode "q=$ITEM_NAME" --data-urlencode "size=10" "$API/items")
expect_json "$(echo "$listed" | jq '.items | length')" "1" "listado público encuentra el platillo"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.name')" "$ITEM_NAME" "detalle público"
filtered=$(curl -s "$API/items?excludeAllergens=pescado&size=100")
found=$(echo "$filtered" | jq --arg id "$item_id" '[.items[] | select(.id == $id)] | length')
expect_json "$found" "0" "excludeAllergens filtra el platillo"
status=$(curl -s -o /dev/null -w '%{http_code}' "$API/items/00000000-0000-4000-8000-000000000099")
expect_status 404 "$status" "detalle público inexistente"

section "Renombrar categoría"
renamed=$(curl -s -X PUT "$API/admin/categories/$category_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NEW_CATEGORY_NAME\"}")
expect_json "$(echo "$renamed" | jq -r '.itemsUpdated')" "1" "renombre publica un evento por platillo"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.category.name')" "$NEW_CATEGORY_NAME" "el detalle refleja el nuevo nombre"
new_revision=$(echo "$detail" | jq -r '.name' >/dev/null; curl -s "$API/admin/items?size=100" -H "$AUTH_HEADER" | jq -r --arg id "$item_id" '.items[] | select(.id == $id) | .revision')
expect_json "$new_revision" "4" "el renombre sube la revisión del platillo"

section "Fotos (Hito 2)"
python3 - <<'PY'
import base64
open('/tmp/hachi-smoke.png', 'wb').write(base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
))
PY

photo=$(curl -s -X PUT "$API/admin/items/$item_id/photo" \
  -H "$AUTH_HEADER" -F 'file=@/tmp/hachi-smoke.png;type=image/png')
photo_url=$(echo "$photo" | jq -r '.photoUrl')
[[ "$photo_url" != "null" && -n "$photo_url" ]] || fail "no se subió la foto: $photo"
ok "foto subida"

media_headers=$(mktemp)
status=$(curl -s -D "$media_headers" -o /tmp/hachi-smoke-media.png -w '%{http_code}' "$photo_url")
expect_status 200 "$status" "descarga de foto"
cmp -s /tmp/hachi-smoke.png /tmp/hachi-smoke-media.png || fail "la foto descargada no coincide"
etag=$(awk -F': ' 'tolower($1)=="etag"{print $2}' "$media_headers" | tr -d '\r')
[[ -n "$etag" ]] || fail "la foto no devolvió ETag"
status=$(curl -s -o /dev/null -w '%{http_code}' "$photo_url" -H "If-None-Match: $etag")
expect_status 304 "$status" "ETag de foto"
rm -f "$media_headers"

echo "not an image" > /tmp/hachi-fake.png
status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$item_id/photo" \
  -H "$AUTH_HEADER" -F 'file=@/tmp/hachi-fake.png;type=image/png')
expect_status 400 "$status" "formato de foto inválido"

dd if=/dev/zero of=/tmp/hachi-big.png bs=1m count=6 2>/dev/null
status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$item_id/photo" \
  -H "$AUTH_HEADER" -F 'file=@/tmp/hachi-big.png;type=image/png')
expect_status 400 "$status" "foto mayor a 5 MB"

removed=$(curl -s -X DELETE "$API/admin/items/$item_id/photo" -H "$AUTH_HEADER")
expect_json "$(echo "$removed" | jq -r '.photoUrl')" "null" "foto eliminada"
status=$(curl -s -o /dev/null -w '%{http_code}' "$photo_url")
expect_status 404 "$status" "la foto eliminada ya no se sirve"

section "Reglas de categoría"
status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/categories/$category_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"active":false}')
expect_status 409 "$status" "no se desactiva una categoría con platillos activos"

inactive=$(curl -s -X POST "$API/admin/categories" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Inactive $SUFFIX\",\"displayOrder\":101}")
inactive_id=$(echo "$inactive" | jq -r '.id')
off=$(curl -s -X PATCH "$API/admin/categories/$inactive_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"active":false}')
expect_json "$(echo "$off" | jq -r '.active')" "false" "categoría auxiliar desactivada"
status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$item_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"revision\":4,\"categoryId\":\"$inactive_id\"}")
expect_status 422 "$status" "un platillo activo no se mueve a categoría inactiva"
status=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/admin/categories/$inactive_id" -H "$AUTH_HEADER")
expect_status 204 "$status" "borrar categoría auxiliar vacía"

empty=$(curl -s -X POST "$API/admin/categories" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Empty $SUFFIX\",\"displayOrder\":100}")
empty_id=$(echo "$empty" | jq -r '.id')
status=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/admin/categories/$empty_id" -H "$AUTH_HEADER")
expect_status 204 "$status" "borrar categoría sin platillos"

status=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$API/admin/categories/$category_id" -H "$AUTH_HEADER")
expect_status 409 "$status" "no se borra una categoría que tuvo platillos"

section "Desactivar platillo y categoría"
deactivated=$(curl -s -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":false,"revision":4}')
expect_json "$(echo "$deactivated" | jq -r '.revision')" "5" "desactivar sube a revision 5"

status=$(curl -s -o /dev/null -w '%{http_code}' "$API/items/$item_id")
expect_status 404 "$status" "el detalle público oculta un platillo inactivo"

category_off=$(curl -s -X PATCH "$API/admin/categories/$category_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"active":false}')
expect_json "$(echo "$category_off" | jq -r '.active')" "false" "categoría desactivada sin platillos activos"

section "Menú público y caché"
menu=$(curl -s "$API")
found=$(echo "$menu" | jq --arg id "$item_id" '[.categories[].items[] | select(.id == $id)] | length')
expect_json "$found" "0" "el menú no muestra platillos de categorías inactivas"
etag=$(curl -s -D - -o /dev/null "$API" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
[[ -n "$etag" ]] || fail "el menú público no devolvió ETag"
status=$(curl -s -o /dev/null -w '%{http_code}' "$API" -H "If-None-Match: $etag")
expect_status 304 "$status" "ETag condicional del menú"

section "Outbox"
if has_docker_db; then
  rows=$(psql_value "select count(*) from outbox_event where aggregate_id = '$item_id';")
  expect_json "$rows" "5" "5 eventos publicables en el Outbox"
else
  echo "AVISO: no se pudo consultar el Outbox (docker compose no disponible)"
fi

echo
echo "Smoke test completado correctamente."
