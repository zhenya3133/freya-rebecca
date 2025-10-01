#!/usr/bin/env bash
set -euo pipefail

# Быстрый self-check для /api/ingest/pdf
# Требуется: BASE, ADMIN_KEY
: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY}"

NS="${1:-rebecca/army/refs}"
SLOT="${2:-staging}"
PDF_URL="${3:-https://arxiv.org/pdf/1706.03762.pdf}"

echo "[SMOKE:PDF] 1) Dry-run…"
jq -n --arg ns "$NS" --arg slot "$SLOT" --arg url "$PDF_URL" \
'{
  ns:$ns, slot:$slot, url:$url,
  dryRun:true,
  chunk:{chars:1200, overlap:180}
}' \
| curl -fsS -X POST "$BASE/api/ingest/pdf" \
  -H "content-type: application/json" -H "x-admin-key: $ADMIN_KEY" \
  --data-binary @- \
| jq '{ok, textChunks, ms}'

echo "[SMOKE:PDF] 2) Real ingest (no embeddings)…"
jq -n --arg ns "$NS" --arg slot "$SLOT" --arg url "$PDF_URL" \
'{
  ns:$ns, slot:$slot, url:$url,
  skipEmbeddings:true,
  chunk:{chars:1200, overlap:180}
}' \
| curl -fsS -X POST "$BASE/api/ingest/pdf" \
  -H "content-type: application/json" -H "x-admin-key: $ADMIN_KEY" \
  --data-binary @- \
| jq '{ok, textInserted, textUpdated, unchanged, embedWritten, ms}'

echo "[SMOKE:PDF] 3) Backfill embeddings…"
this_ns="$NS" this_slot="$SLOT"
apps/web/scripts/embed_backfill.sh "$this_ns" "$this_slot" 100 16 || true

echo "[SMOKE:PDF] 4) NULL embeddings by URL…"
apps/web/scripts/run_admin_sql.sh "
SELECT COUNT(*) AS nulls_by_url
FROM chunks
WHERE ns='${NS}'
  AND slot='${SLOT}'
  AND source_id='${PDF_URL}'
  AND embedding IS NULL;
"
