#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/ingest_url.sh rebecca/army/refs staging https://www.rfc-editor.org/rfc/rfc2616
# Требования: BASE, X_ADMIN_KEY в окружении.

: "${BASE:?need BASE like http://localhost:3000}"
: "${X_ADMIN_KEY:?need X_ADMIN_KEY from .env.local}"

NS="${1:?need ns}"
SLOT="${2:?need slot}"
URL="${3:?need url}"

jq -n --arg ns "$NS" --arg slot "$SLOT" --arg url "$URL" \
  '{ ns:$ns, slot:$slot, urls:[$url], followRedirects:true }' \
| curl -sS -X POST "$BASE/api/ingest/url" \
  -H "content-type: application/json" \
  -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @-
echo
