# apps/web/scripts/e2e/bootstrap_demo.sh
#!/usr/bin/env bash
set -euo pipefail

WEB_DIR="$(cd "$(dirname "$0")/../../.." && pwd)/web"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"

# админ-ключ обязателен для /api/ingest/*
ADMIN="${X_ADMIN_KEY:-${X_ADMIN_KEY_FILE:+$(cat "$X_ADMIN_KEY_FILE")}}"

# локальный PDF (для удобства на WSL/Windows)
LOCAL_PDF="${LOCAL_PDF:-}"

echo "WEB_DIR=$WEB_DIR"
echo "BASE=$BASE"
echo "NS=$NS SLOT=$SLOT"

if [[ -z "${ADMIN:-}" ]]; then
  echo "ERROR: X_ADMIN_KEY не задан. Экспортни его (или X_ADMIN_KEY_FILE) и перезапусти." >&2
  exit 1
fi

# маленький хелпер: POST JSON, печатаем код и тело; при 2xx — прогоняем через jq
post_json () {
  local endpoint="$1"; shift
  local json="$1"; shift

  local tmp="$(mktemp)"
  local code
  code=$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$BASE$endpoint" \
    -H 'content-type: application/json' \
    -H "x-admin-key: ${ADMIN}" \
    --data "$json" || true)

  if [[ "$code" =~ ^2 ]]; then
    # корректный JSON → можно выборочно показать поля
    jq . "$tmp"
  else
    echo "HTTP $code"
    cat "$tmp"
    rm -f "$tmp"
    exit 1
  fi
  rm -f "$tmp"
}

# 0) подчистим
echo ">> TRUNCATE chunks for ns=$NS slot=$SLOT"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
  "DELETE FROM chunks WHERE ns = '$NS' AND slot = '$SLOT';"

# 1) ingest URL (MDN)
echo ">> ingest URL (MDN)"
URL_BODY=$(jq -n \
  --arg ns   "$NS" \
  --arg slot "$SLOT" \
  --argjson urls '[
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop",
    "https://developer.mozilla.org/en-US/docs/Web/API/Console/table",
    "https://developer.mozilla.org/en-US/docs/Web/API/console/time"
  ]' \
  '{
     ns: $ns, slot: $slot,
     urls: $urls,
     chunk: { chars: 1200, overlap: 150 }
   }')
post_json "/api/ingest/url" "$URL_BODY" | jq '{ok, textChunks, textInserted, textUpdated, failures}'

# 2) ingest PDF (локалка или небольшой публичный PDF)
PDF_URL="$LOCAL_PDF"
if [[ -z "$PDF_URL" ]]; then
  PDF_URL="https://arxiv.org/pdf/2402.19472.pdf"
fi
echo ">> ingest PDF ($PDF_URL)"
PDF_BODY=$(jq -n \
  --arg ns   "$NS" \
  --arg slot "$SLOT" \
  --arg url  "$PDF_URL" \
  '{
     ns: $ns, slot: $slot,
     url: $url,
     chunk: { chars: 1200, overlap: 150 }
   }')
post_json "/api/ingest/pdf" "$PDF_BODY" | jq '{ok, pages, chunks, textInserted, textUpdated}'

# 3) ingest GitHub (малое окно)
echo ">> ingest GitHub (openai/openai-cookbook, .md, limit 10)"
GH_BODY=$(jq -n \
  --arg ns   "$NS" \
  --arg slot "$SLOT" \
  '{
     ns: $ns, slot: $slot,
     owner: "openai", repo: "openai-cookbook",
     includeExt: [".md"],
     limit: 10,
     chunk: { chars: 1200, overlap: 150 }
   }')
post_json "/api/ingest/github" "$GH_BODY" | jq '{ok, pageFiles, docs, textChunks, inserted, updated, nextCursor}'

# 4) ANALYZE
echo ">> ANALYZE chunks"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c "ANALYZE chunks;"

# 5) сводка
echo ">> summary:"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -f "$WEB_DIR/scripts/diag/count_ns.sql"
