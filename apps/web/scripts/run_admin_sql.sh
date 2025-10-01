#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/run_admin_sql.sh "SELECT 1;"
# Требования: BASE, ADMIN_KEY в окружении.

: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY (dev-12345 from .env.local)}"

SQL="${1:-}"
if [[ -z "$SQL" ]]; then
  echo "Usage: $0 \"SELECT 1;\"" >&2
  exit 1
fi

jq -n --arg sql "$SQL" '{sql:$sql}' \
| curl -sS -X POST "$BASE/api/admin/sql" \
  -H "content-type: application/json" \
  -H "x-admin-key: $ADMIN_KEY" \
  --data-binary @-
echo
