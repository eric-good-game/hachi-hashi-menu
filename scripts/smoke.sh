#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
API="$BASE_URL/api/menu"
AUTH_HEADER="Authorization: Bearer dev-admin-token"
SUFFIX="$(date +%s)"
CATEGORY_NAME="Smoke $SUFFIX"
ITEM_NAME="Walking skeleton $SUFFIX"

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
[[ "$revision" == "1" ]] || fail "el platillo debe nacer con revision 1"
echo "OK  platillo $item_id, revision $revision"

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
[[ "$reviewed" == "true" ]] || fail "allergensReviewed no quedó en true"
[[ "$count" == "2" ]] || fail "los alérgenos deben quedar deduplicados"
echo "OK  alérgenos revisados"

echo "== Activar platillo =="
activated=$(curl -s -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
active=$(echo "$activated" | jq -r '.active')
new_revision=$(echo "$activated" | jq -r '.revision')
[[ "$active" == "true" ]] || fail "el platillo no quedó activo"
[[ "$new_revision" == "2" ]] || fail "la activación debe subir la revisión a 2"
echo "OK  platillo activo, revision $new_revision"

echo "== Revisión desactualizada =="
status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/items/$item_id/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":false,"revision":1}')
expect_status 409 "$status" "revisión desactualizada"

echo "== Menú público =="
menu=$(curl -s "$API")
found=$(echo "$menu" | jq --arg id "$item_id" '[.categories[].items[] | select(.id == $id)] | length')
[[ "$found" == "1" ]] || fail "el platillo activo no aparece en el menú público"
etag=$(curl -s -D - -o /dev/null "$API" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
[[ -n "$etag" ]] || fail "el menú público no devolvió ETag"
status=$(curl -s -o /dev/null -w '%{http_code}' "$API" -H "If-None-Match: $etag")
expect_status 304 "$status" "ETag condicional"
echo "OK  menú público con ETag"

echo "== Outbox =="
if command -v docker >/dev/null 2>&1 && docker compose ps menu-db >/dev/null 2>&1; then
  rows=$(docker compose exec -T menu-db psql -U menu -d menu -tAc \
    "select count(*) from outbox_event where aggregate_id = '$item_id';" | tr -d '[:space:]')
  [[ "$rows" == "2" ]] || fail "esperaba 2 eventos en el Outbox, encontré $rows"
  echo "OK  Outbox con 2 eventos para el platillo"
else
  echo "AVISO: no se pudo consultar el Outbox (docker compose no disponible)"
fi

echo
echo "Smoke test completado correctamente."
