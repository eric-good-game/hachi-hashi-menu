#!/usr/bin/env bash
#
# Helpers compartidos por los scripts de humo del servicio Menu/Catalog.
# No es un script ejecutable: se carga con `source` desde
# `scripts/smoke.sh` (API y flujos de la etapa A) y
# `scripts/smoke-messaging.sh` (consumidor RabbitMQ real).
#
# Requiere `curl` y `jq`; `docker compose` solo para las comprobaciones de
# base de datos y de colas.

: "${BASE_URL:=http://localhost:3000}"
: "${API:=${BASE_URL}/api/menu}"
: "${AUTH_HEADER:=Authorization: Bearer dev-admin-token}"

fail() {
  echo "FALLO: $1" >&2
  exit 1
}

section() {
  echo
  echo "== $1 =="
}

ok() {
  echo "OK  $1"
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

# Comprueba que el servicio responde en /health antes de continuar.
require_health() {
  local status
  status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")
  expect_status 200 "$status" "health"
}

# --- Fixtures de administración -------------------------------------------

create_category() {
  local name="$1"
  local display_order="${2:-99}"
  local category id

  category=$(curl -s -X POST "$API/admin/categories" \
    -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$name\",\"displayOrder\":$display_order}")
  id=$(echo "$category" | jq -r '.id')
  if [[ -z "$id" || "$id" == "null" ]]; then
    fail "no se pudo crear la categoría '$name': $category"
  fi
  echo "$id"
}

create_item() {
  local category_id="$1"
  local name="$2"
  local price_cents="${3:-12345}"
  local item id

  item=$(curl -s -X POST "$API/admin/items" \
    -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d "{\"categoryId\":\"$category_id\",\"name\":\"$name\",\"description\":\"Smoke test\",\"priceCents\":$price_cents,\"displayOrder\":1}")
  id=$(echo "$item" | jq -r '.id')
  if [[ -z "$id" || "$id" == "null" ]]; then
    fail "no se pudo crear el platillo '$name': $item"
  fi
  echo "$id"
}

# Marca los alérgenos como revisados; por defecto sin alérgenos.
review_allergens() {
  local item_id="$1"
  local codes_json="${2:-[]}"
  local status

  status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$item_id/allergens" \
    -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d "{\"allergenCodes\":$codes_json}")
  expect_status 200 "$status" "revisar alérgenos"
}

activate_item() {
  local item_id="$1"
  local revision="$2"
  local status

  status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/items/$item_id/status" \
    -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
    -d "{\"active\":true,\"revision\":$revision}")
  expect_status 200 "$status" "activar platillo"
}

# --- Inspección de infraestructura ---------------------------------------

has_docker_db() {
  command -v docker >/dev/null 2>&1 && docker compose ps menu-db >/dev/null 2>&1
}

# Ejecuta SQL de solo lectura sobre la base del compose.
psql_value() {
  docker compose exec -T menu-db psql -U menu -d menu -tAc "$1" | tr -d '[:space:]'
}

queue_messages() {
  local queue="$1"
  docker compose exec -T rabbitmq rabbitmqctl list_queues --quiet name messages \
    | awk -v q="$queue" '$1 == q { print $2 }' \
    | head -n 1
}

# Espera a que el detalle público de un platillo refleje `available`.
wait_for_available() {
  local item_id="$1"
  local expected="$2"
  local label="$3"
  local timeout_seconds="${4:-30}"
  local deadline=$((SECONDS + timeout_seconds))

  while (( SECONDS < deadline )); do
    local actual
    actual=$(curl -s "$API/items/$item_id" | jq -r 'if has("available") then (.available|tostring) else "missing" end')
    if [[ "$actual" == "$expected" ]]; then
      echo "OK  $label (available=$expected)"
      return 0
    fi
    sleep 1
  done

  fail "$label: disponible no llegó a $expected"
}
