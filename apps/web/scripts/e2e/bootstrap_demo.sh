#!/usr/bin/env bash
set -euo pipefail

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$WEB_DIR"

: "${DATABASE_URL:?DATABASE_URL is required}"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
X_ADMIN_KEY="${X_ADMIN_KEY:-${ADMIN:-}}"

echo "WEB_DIR=$WEB_DIR"
echo "BASE=$BASE"
echo "NS=$NS SLOT=$SLOT"

psql_np() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off "$@"; }
show_or_err() { jq 'if .ok==true or .ok==null then . else {ok,stage,error} end'; }

# опциональный заголовок x-admin-key
HDR_AUTH=()
if [[ -n "${X_ADMIN_KEY:-}" ]]; then
  HDR_AUTH=(-H "x-admin-key: ${X_ADMIN_KEY}")
fi

echo ">> TRUNCATE chunks for ns=$NS slot=$SLOT"
psql_np -v ns="$NS" -v slot="$SLOT" <<'SQL'
DELETE FROM chunks WHERE ns = :'ns' AND slot = :'slot';
SQL

echo ">> ingest URL (MDN)"
jq -n --arg ns "$NS" --arg slot "$SLOT" '
{
  ns: $ns,
  slot: $slot,
  urls: [
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop",
    "https://developer.mozilla.org/en-US/docs/Web/API/Console/table",
    "https://developer.mozilla.org/en-US/docs/Web/API/console/time"
  ],
  chunk: { chars: 1200, overlap: 150 }
}
' | curl -sS -X POST "$BASE/api/ingest/url" \
      -H 'content-type: application/json' "${HDR_AUTH[@]}" \
      -d @- | show_or_err

PDF_URL="${LOCAL_PDF:-https://arxiv.org/pdf/2402.19472.pdf}"
echo ">> ingest PDF ($PDF_URL)"
jq -n --arg ns "$NS" --arg slot "$SLOT" --arg url "$PDF_URL" '
{
  ns: $ns,
  slot: $slot,
  url: $url,
  chunk: { chars: 1200, overlap: 150 }
}
' | curl -sS -X POST "$BASE/api/ingest/pdf" \
      -H 'content-type: application/json' "${HDR_AUTH[@]}" \
      -d @- | show_or_err

echo ">> ingest GitHub (openai/openai-cookbook, .md, limit 10)"
jq -n --arg ns "$NS" --arg slot "$SLOT" '
{
  ns: $ns,
  slot: $slot,
  owner: "openai",
  repo: "openai-cookbook",
  ref: "main",
  includeExt: [".md"],
  cursor: 0,
  limit: 10,
  chunk: { chars: 1200, overlap: 150 }
}
' | curl -sS -X POST "$BASE/api/ingest/github" \
      -H 'content-type: application/json' "${HDR_AUTH[@]}" \
      -d @- | show_or_err

echo ">> ANALYZE chunks"
psql_np -c "ANALYZE chunks;"

echo ">> summary:"
psql_np -v ns="$NS" -f "$WEB_DIR/scripts/diag/count_ns.sql"
