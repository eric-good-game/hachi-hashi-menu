#!/usr/bin/env bash
set -euo pipefail

# Humo del consumidor RabbitMQ real (Hitos 3 y 4): aplica disponibilidad,
# idempotencia por messageId, descarte de mensajes viejos, DLQ por contrato
# inválido, ausencia de eventos en el Outbox y replay de la DLQ.
#
# Uso:
#   ./scripts/smoke-messaging.sh [--help]
#
# Requiere:
#   - El servicio de la etapa A levantado con OUTBOX_PUBLISH_ENABLED=true,
#     CONSUMERS_ENABLED=true y DEV_TOOLS_ENABLED=true.
#   - RabbitMQ del compose: docker compose --profile messaging up -d rabbitmq
#
# Variables:
#   BASE_URL      (por defecto http://localhost:3000)
#   RABBITMQ_URL  (por defecto amqp://menu:menu@localhost:5672)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/smoke-common.sh
source "$SCRIPT_DIR/lib/smoke-common.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'TXT'
Humo del consumidor RabbitMQ real (Hitos 3 y 4).

Uso: ./scripts/smoke-messaging.sh [--help]

Cubre: disponibilidad aplicada, duplicado ignorado, mensaje viejo descartado,
mensaje nuevo aplicado, contrato inválido en la DLQ, la disponibilidad no
publica eventos y el replay de la DLQ en modo --dry-run.

Requiere el servicio levantado con OUTBOX_PUBLISH_ENABLED=true,
CONSUMERS_ENABLED=true y DEV_TOOLS_ENABLED=true, y RabbitMQ del compose
(docker compose --profile messaging up -d rabbitmq).

Variables:
  BASE_URL      URL base del servicio (por defecto http://localhost:3000)
  RABBITMQ_URL  Broker AMQP (por defecto amqp://menu:menu@localhost:5672)
TXT
  exit 0
fi

RABBITMQ_URL="${RABBITMQ_URL:-amqp://menu:menu@localhost:5672}"
PUBLISHER=(node "$SCRIPT_DIR/dev-inventory-publisher.cjs" --url "$RABBITMQ_URL")
REPLAY=(node "$SCRIPT_DIR/replay-dlq.cjs" --url "$RABBITMQ_URL")
SUFFIX="$(date +%s)"
CATEGORY_NAME="Smoke mensajería $SUFFIX"

section "Salud"
require_health

section "Preparación de platillo"
CATEGORY_ID=$(create_category "$CATEGORY_NAME" 99)
ITEM_ID=$(create_item "$CATEGORY_ID" "Platillo mensajería $SUFFIX" 1000)
ok "categoría $CATEGORY_ID"
ok "platillo $ITEM_ID"
review_allergens "$ITEM_ID"
activate_item "$ITEM_ID" 1

OUTBOX_BEFORE=$(psql_value "select count(*) from outbox_event where aggregate_id = '$ITEM_ID';")

section "Disponibilidad: applied / duplicate / stale / nueva"
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available false >/dev/null
wait_for_available "$ITEM_ID" false "disponibilidad aplicada"

DUPLICATE_ID="00000000-0000-4000-8000-000000000001"
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available false --message-id "$DUPLICATE_ID" >/dev/null
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available true --message-id "$DUPLICATE_ID" >/dev/null
sleep 2
wait_for_available "$ITEM_ID" false "duplicado ignorado"

STALE_AT="2020-01-01T00:00:00.000Z"
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available true --occurred-at "$STALE_AT" >/dev/null
sleep 2
wait_for_available "$ITEM_ID" false "mensaje viejo descartado"

FUTURE_AT="$(date -u -v+1H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+1 hour' '+%Y-%m-%dT%H:%M:%SZ')"
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available true --occurred-at "$FUTURE_AT" >/dev/null
wait_for_available "$ITEM_ID" true "mensaje más reciente aplicado"

OUTBOX_AFTER=$(psql_value "select count(*) from outbox_event where aggregate_id = '$ITEM_ID';")
if [[ "$OUTBOX_BEFORE" != "$OUTBOX_AFTER" ]]; then
  fail "la disponibilidad no debe publicar eventos (outbox $OUTBOX_BEFORE -> $OUTBOX_AFTER)"
fi
ok "la disponibilidad no publica eventos (outbox=$OUTBOX_AFTER)"

section "Contrato inválido hacia la DLQ"
DLQ_BEFORE=$(queue_messages "menu.inventory-events.dlq")
DLQ_BEFORE="${DLQ_BEFORE:-0}"
"${PUBLISHER[@]}" --menu-item-id "$ITEM_ID" --available false --invalid >/dev/null

deadline=$((SECONDS + 30))
DLQ_AFTER="$DLQ_BEFORE"
while (( SECONDS < deadline )); do
  DLQ_AFTER=$(queue_messages "menu.inventory-events.dlq")
  DLQ_AFTER="${DLQ_AFTER:-0}"
  if (( DLQ_AFTER > DLQ_BEFORE )); then
    break
  fi
  sleep 1
done

if (( DLQ_AFTER <= DLQ_BEFORE )); then
  fail "el mensaje con contrato inválido no llegó a la DLQ"
fi
ok "contrato inválido en la DLQ ($DLQ_BEFORE -> $DLQ_AFTER)"

section "Replay de la DLQ (dry-run)"
DRY_RUN=$("${REPLAY[@]}" --limit 5 --dry-run)
expect_json "$(echo "$DRY_RUN" | jq -r '.mode')" "dry-run" "el replay responde en modo dry-run"
if (( $(echo "$DRY_RUN" | jq -r '.replayed') < 1 )); then
  fail "el dry-run no encontró mensajes en la DLQ: $DRY_RUN"
fi
ok "el dry-run inspeccionó $(echo "$DRY_RUN" | jq -r '.replayed') mensaje(s)"

DLQ_AFTER_REPLAY=$(queue_messages "menu.inventory-events.dlq")
DLQ_AFTER_REPLAY="${DLQ_AFTER_REPLAY:-0}"
if (( DLQ_AFTER_REPLAY < DLQ_AFTER )); then
  fail "el dry-run no debe consumir la DLQ ($DLQ_AFTER -> $DLQ_AFTER_REPLAY)"
fi
ok "el dry-run no consumió la DLQ ($DLQ_AFTER -> $DLQ_AFTER_REPLAY)"

section "Publicaciones del Outbox"
echo "Esperado: los eventos del platillo ya publicados (sin filas nuevas por disponibilidad)."
docker compose exec -T menu-db psql -U menu -d menu -c \
  "select seq, type, published_at is not null as publicado from outbox_event where aggregate_id = '$ITEM_ID' order by seq;"

echo
echo "Smoke de mensajería completado correctamente."
