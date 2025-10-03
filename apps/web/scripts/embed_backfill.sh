#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/embed_backfill.sh rebecca/army/refs staging 300 16
#   ./scripts/embed_backfill.sh "" "" 300 16        # без фильтров ns/slot
#
# Требования: BASE, ADMIN_KEY в окружении.

: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY (dev-12345)}"

NS="${1:-}"
SLOT="${2:-}"
LIMIT="${3:-200}"
BATCH="${4:-16}"

if [[ -n "$NS" && -n "$SLOT" ]]; then
  jq -n \
    --arg ns "$NS" \
    --arg slot "$SLOT" \
    --argjson limit "$LIMIT" \
    --argjson batchSize "$BATCH" \
    '{ ns:$ns, slot:$slot, limit:$limit, batchSize:$batchSize }' \
  | curl -sS -X POST "$BASE/api/admin/embed-backfill" \
      -H "content-type: application/json" \
      -H "x-admin-key: $ADMIN_KEY" \
      --data-binary @-
else
  jq -n \
    --argjson limit "$LIMIT" \
    --argjson batchSize "$BATCH" \
    '{ limit:$limit, batchSize:$batchSize }' \
  | curl -sS -X POST "$BASE/api/admin/embed-backfill" \
      -H "content-type: application/json" \
      -H "x-admin-key: $ADMIN_KEY" \
      --data-binary @-
fi

echo