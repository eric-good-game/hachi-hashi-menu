#!/usr/bin/env bash
set -euo pipefail

# Verificación de humo del Hito 3 contra el consumidor RabbitMQ real.
# Requiere:
#   - El servicio levantado con OUTBOX_PUBLISH_ENABLED=true, CONSUMERS_ENABLED=true
#     y DEV_TOOLS_ENABLED=true (etapa A).
#   - RabbitMQ del compose escuchando (perfil "messaging").
#
# Uso:
#   ./scripts/smoke-messaging.sh
#
# Variables:
#   BASE_URL      (por defecto http://localhost:3000)
#   RABBITMQ_URL  (por defecto amqp://menu:menu@localhost:5672)

BASE_URL="${BASE_URL:-http://localhost:3000}"
RABBITMQ_URL="${RABBITMQ_URL:-amqp://menu:menu@localhost:5672}"
API="$BASE_URL/api/menu"
AUTH_HEADER="Authorization: Bearer dev-admin-token"
PUBLISHER="node scripts/dev-inventory-publisher.cjs --url $RABBITMQ_URL"
SUFFIX="$(date +%s)"
CATEGORY_NAME="Smoke mensajería $SUFFIX"

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

queue_messages() {
  local queue="$1"
  docker compose exec -T rabbitmq rabbitmqctl list_queues --quiet name messages \
    | awk -v q="$queue" '$1 == q { print $2 }' \
    | head -n 1
}

wait_for_available() {
  local item_id="$1"
  local expected="$2"
  local label="$3"
  local deadline=$((SECONDS + 30))

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

echo "== Salud =="
status=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/health")
expect_status 200 "$status" "health"

echo "== Preparación de platillo =="
CATEGORY_ID=$(curl -s -X POST "$API/admin/categories" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$CATEGORY_NAME\",\"displayOrder\":99}" | jq -r '.id')
if [[ -z "$CATEGORY_ID" || "$CATEGORY_ID" == "null" ]]; then
  fail "no se pudo crear la categoría de humo"
fi

ITEM_ID=$(curl -s -X POST "$API/admin/items" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "{\"categoryId\":\"$CATEGORY_ID\",\"name\":\"Platillo mensajería $SUFFIX\",\"description\":\"Humo de mensajería\",\"priceCents\":1000,\"displayOrder\":1}" \
  | jq -r '.id')
if [[ -z "$ITEM_ID" || "$ITEM_ID" == "null" ]]; then
  fail "no se pudo crear el platillo de humo"
fi

status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$API/admin/items/$ITEM_ID/allergens" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"allergenCodes":[]}')
expect_status 200 "$status" "revisar alérgenos"

status=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/admin/items/$ITEM_ID/status" \
  -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"active":true,"revision":1}')
expect_status 200 "$status" "activar platillo"

OUTBOX_BEFORE=$(docker compose exec -T menu-db psql -U menu -d menu -tA \
  -c "select count(*) from outbox_event where aggregate_id = '$ITEM_ID';" | tr -d '[:space:]')

echo "== Disponibilidad: applied / duplicate / stale / nueva =="
$PUBLISHER --menu-item-id "$ITEM_ID" --available false >/dev/null
wait_for_available "$ITEM_ID" false "disponibilidad aplicada"

DUPLICATE_ID="00000000-0000-4000-8000-000000000001"
$PUBLISHER --menu-item-id "$ITEM_ID" --available false --message-id "$DUPLICATE_ID" >/dev/null
$PUBLISHER --menu-item-id "$ITEM_ID" --available true --message-id "$DUPLICATE_ID" >/dev/null
sleep 2
wait_for_available "$ITEM_ID" false "duplicado ignorado"

STALE_AT="2020-01-01T00:00:00.000Z"
$PUBLISHER --menu-item-id "$ITEM_ID" --available true --occurred-at "$STALE_AT" >/dev/null
sleep 2
wait_for_available "$ITEM_ID" false "mensaje viejo descartado"

FUTURE_AT="$(date -u -v+1H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+1 hour' '+%Y-%m-%dT%H:%M:%SZ')"
$PUBLISHER --menu-item-id "$ITEM_ID" --available true --occurred-at "$FUTURE_AT" >/dev/null
wait_for_available "$ITEM_ID" true "mensaje más reciente aplicado"

OUTBOX_AFTER=$(docker compose exec -T menu-db psql -U menu -d menu -tA \
  -c "select count(*) from outbox_event where aggregate_id = '$ITEM_ID';" | tr -d '[:space:]')
if [[ "$OUTBOX_BEFORE" != "$OUTBOX_AFTER" ]]; then
  fail "la disponibilidad no debe publicar eventos (outbox $OUTBOX_BEFORE -> $OUTBOX_AFTER)"
fi
echo "OK  la disponibilidad no publica eventos (outbox=$OUTBOX_AFTER)"

echo "== Contrato inválido hacia la DLQ =="
DLQ_BEFORE=$(queue_messages "menu.inventory-events.dlq")
DLQ_BEFORE="${DLQ_BEFORE:-0}"
$PUBLISHER --menu-item-id "$ITEM_ID" --available false --invalid >/dev/null

deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  DLQ_AFTER=$(queue_messages "menu.inventory-events.dlq")
  DLQ_AFTER="${DLQ_AFTER:-0}"
  if (( DLQ_AFTER > DLQ_BEFORE )); then
    echo "OK  contrato inválido en la DLQ ($DLQ_BEFORE -> $DLQ_AFTER)"
    break
  fi
  sleep 1
done

if (( ${DLQ_AFTER:-0} <= DLQ_BEFORE )); then
  fail "el mensaje con contrato inválido no llegó a la DLQ"
fi

echo "== Publicaciones del Outbox =="
docker compose exec -T menu-db psql -U menu -d menu -tA \
  -c "select seq, type, published_at is not null as publicado from outbox_event where aggregate_id = '$ITEM_ID' order by seq;"

echo "TODO OK"
