#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
NS=${NS:-rebecca/army/refs}
SLOT=${SLOT:-staging}
X_ADMIN_KEY=${X_ADMIN_KEY:?X_ADMIN_KEY not set}

URLS='["https://news.ycombinator.com","https://example.com"]'

echo "[1/2] Ingest URL list"
curl -sS -X POST "$BASE/api/ingest/url" \
  -H "content-type: application/json" -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @- <<EOF | jq '{ok,textChunks,textInserted,textUpdated,unchanged,embedWritten,error}'
{ "ns":"$NS", "slot":"$SLOT", "urls": $URLS, "chunk": {"chars": 1200, "overlap": 120} }
EOF

echo "[2/2] Retrieve sanity query"
curl -sS -X POST "$BASE/api/retrieve" \
  -H "content-type: application/json" \
  --data-binary @- <<EOF | jq '{items:[.items[0,1]], filterInfo, debugVersion}'
{ "q":"homepage", "ns":"$NS", "slot":"$SLOT", "nsMode":"prefix", "topK":5, "candidateK":200, "minSimilarity":0 }
EOF
