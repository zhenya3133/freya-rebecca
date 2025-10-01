#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
NS=${NS:-rebecca/army/refs}
SLOT=${SLOT:-staging}
X_ADMIN_KEY=${X_ADMIN_KEY:?X_ADMIN_KEY not set}
PDF_URL="https://arxiv.org/pdf/2402.19472.pdf"

echo "[1/2] Ingest PDF: $PDF_URL"
curl -sS -X POST "$BASE/api/ingest/pdf" \
  -H "content-type: application/json" -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @- <<EOF | jq '{ok,textInserted,textUpdated,unchanged,error}'
{
  "ns": "$NS",
  "slot": "$SLOT",
  "url": "$PDF_URL",
  "chunk": {"chars": 1200, "overlap": 120},
  "minChars": 64
}
EOF

echo "[2/2] Retrieve sanity query"
curl -sS -X POST "$BASE/api/retrieve" \
  -H "content-type: application/json" \
  --data-binary @- <<EOF | jq '{items:[.items[0,1]], filterInfo, debugVersion}'
{
  "q": "event loop microtask",
  "ns": "$NS",
  "slot": "$SLOT",
  "nsMode": "prefix",
  "topK": 5,
  "candidateK": 200,
  "minSimilarity": 0
}
EOF
