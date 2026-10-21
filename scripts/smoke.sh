#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API="$BASE_URL/api/menu"
AUTH_HEADER="Authorization: Bearer dev-admin-token"
SUFFIX="$(date +%s)"
CATEGORY_NAME="Smoke $SUFFIX"
ITEM_NAME="Walking skeleton $SUFFIX"
NEW_CATEGORY_NAME="Smoke renamed $SUFFIX"

fail() {
  echo "FALLO: $1" >&2
  exit 1
}

expect_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label: esperaba HTTP $expected, recibí $actual"
  fi
  echo "OK  $label ($actual)"
}

expect_json() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label: esperaba '$expected', recibí '$actual'"
  fi
  echo "OK  $label"
}

echo "== Salud =="
status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")
expect_status 200 "$status" "health"

echo "== Autenticación =="
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/admin/categories" \
  -H 'Content-Type: application/json' -d '{"name":"Sin token","displayOrder":1}')
expect_status 401 "$status" "sin token"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/admin/categories" \
  -H 'Authorization: Bearer dev-viewer-token' -H 'Content-Type: application/json' \
  -d '{"name":"Sin rol","displayOrder":1}')
expect_status 403 "$status" "sin rol admin"

echo "== Crear categoría =="
category=$(curl -s -X POST "$API/admin/categories" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$CATEGORY_NAME\",\"displayOrder\":99}")
category_id=$(echo "$category" | jq -r '.id')
[[ "$category_id" != "null" && -n "$category_id" ]] || fail "no se creó la categoría: $category"
echo "OK  categoría $category_id"

echo "== Crear platillo =="
item=$(curl -s -X POST "$API/admin/items" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$category_id\",\"name\":\"$ITEM_NAME\",\"description\":\"Smoke test\",\"priceCents\":12345,\"displayOrder\":1}")
item_id=$(echo "$item" | jq -r '.id')
revision=$(echo "$item" | jq -r '.revision')
[[ "$item_id" != "null" && -n "$item_id" ]] || fail "no se creó el platillo: $item"
expect_json "$revision" "1" "platillo nace con revision 1"
echo "OK  platillo $item_id"

echo "== Activar sin alérgenos =="
status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
expect_status 422 "$status" "activación sin alérgenos"

echo "== Revisar alérgenos =="
allergens=$(curl -s -X PUT "$API/admin/items/$item_id/allergens" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"allergenCodes":["pescado","soya","pescado"]}')
reviewed=$(echo "$allergens" | jq -r '.allergensReviewed')
count=$(echo "$allergens" | jq '.allergens | length')
expect_json "$reviewed" "true" "alérgenos revisados"
expect_json "$count" "2" "alérgenos deduplicados"

echo "== Activar platillo =="
activated=$(curl -s -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
expect_json "$(echo "$activated" | jq -r '.active')" "true" "platillo activo"
expect_json "$(echo "$activated" | jq -r '.revision')" "2" "activación sube a revision 2"

echo "== Editar platillo (Hito 2) =="
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

echo "== Consultas públicas de platillos =="
listed=$(curl -s --get --data-urlencode "q=$ITEM_NAME" --data-urlencode "size=10" "$API/items")
expect_json "$(echo "$listed" | jq '.items | length')" "1" "listado público encuentra el platillo"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.name')" "$ITEM_NAME" "detalle público"
filtered=$(curl -s "$API/items?excludeAllergens=pescado&size=100")
found=$(echo "$filtered" | jq --arg id "$item_id" '[.items[] | select(.id == $id)] | length')
expect_json "$found" "0" "excludeAllergens filtra el platillo"
status=$(curl -s -o /dev/null -w '%{http_code}' "$API/items/00000000-0000-4000-8000-000000000099")
expect_status 404 "$status" "detalle público inexistente"

echo "== Renombrar categoría =="
renamed=$(curl -s -X PUT "$API/admin/categories/$category_id" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NEW_CATEGORY_NAME\"}")
expect_json "$(echo "$renamed" | jq -r '.itemsUpdated')" "1" "renombre publica un evento por platillo"
detail=$(curl -s "$API/items/$item_id")
expect_json "$(echo "$detail" | jq -r '.category.name')" "$NEW_CATEGORY_NAME" "el detalle refleja el nuevo nombre"
new_revision=$(echo "$detail" | jq -r '.name' >/dev/null; curl -s "$API/admin/items?size=100" -H "$AUTH_HEADER" | jq -r --arg id "$item_id" '.items[] | select(.id == $id) | .revision')
expect_json "$new_revision" "4" "el renombre sube la revisión del platillo"

echo "== Fotos (Hito 2) =="
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
echo "OK  foto subida"

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

echo "== Reglas de categoría =="
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

echo "== Desactivar platillo y categoría =="
deactivated=$(curl -s -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":false,"revision":4}')
expect_json "$(echo "$deactivated" | jq -r '.revision')" "5" "desactivar sube a revision 5"

status=$(curl -s -o /dev/null -w '%{http_code}' "$API/items/$item_id")
expect_status 404 "$status" "el detalle público oculta un platillo inactivo"

category_off=$(curl -s -X PATCH "$API/admin/categories/$category_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' -d '{"active":false}')
expect_json "$(echo "$category_off" | jq -r '.active')" "false" "categoría desactivada sin platillos activos"

echo "== Menú público y caché =="
menu=$(curl -s "$API")
found=$(echo "$menu" | jq --arg id "$item_id" '[.categories[].items[] | select(.id == $id)] | length')
expect_json "$found" "0" "el menú no muestra platillos de categorías inactivas"
etag=$(curl -s -D - -o /dev/null "$API" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
[[ -n "$etag" ]] || fail "el menú público no devolvió ETag"
status=$(curl -s -o /dev/null -w '%{http_code}' "$API" -H "If-None-Match: $etag")
expect_status 304 "$status" "ETag condicional del menú"

echo "== Outbox =="
if command -v docker >/dev/null 2>&1 && docker compose ps menu-db >/dev/null 2>&1; then
  rows=$(docker compose exec -T menu-db psql -U menu -d menu -tAc \
    "select count(*) from outbox_event where aggregate_id = '$item_id';" | tr -d '[:space:]')
  expect_json "$rows" "5" "5 eventos publicables en el Outbox"
else
  echo "AVISO: no se pudo consultar el Outbox (docker compose no disponible)"
fi

echo
echo "Smoke test completado correctamente."
