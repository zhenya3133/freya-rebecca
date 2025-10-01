#!/usr/bin/env bash
set -euo pipefail

BASE=${BASE:-http://localhost:3000}
NS=${NS:-rebecca/army/refs}
SLOT=${SLOT:-staging}
X_ADMIN_KEY=${X_ADMIN_KEY:?X_ADMIN_KEY not set}

OWNER=${OWNER:-vercel}
REPO=${REPO:-next.js}
REF=${REF:-canary}

echo "[1/2] Ingest GitHub repo: $OWNER/$REPO@$REF (text files only, skip embeddings)"

REQ_JSON=$(jq -n \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  --arg owner "$OWNER" \
  --arg repo "$REPO" \
  --arg ref "$REF" \
  --arg kind "github" \
  --argjson includeExt '[".md",".mdx",".txt",".js",".ts"]' \
  --argjson chunk '{"chars":1200,"overlap":120}' \
  --argjson limit 25 \
  --argjson skipEmbeddings true \
  '{ns:$ns, slot:$slot, kind:$kind, owner:$owner, repo:$repo, ref:$ref, includeExt:$includeExt, chunk:$chunk, limit:$limit, skipEmbeddings:$skipEmbeddings}')

echo "$REQ_JSON" | curl -sS -X POST "$BASE/api/ingest/github" \
  -H "content-type: application/json" \
  -H "x-admin-key: $X_ADMIN_KEY" \
  --data-binary @- | jq '{ok,textChunks,textInserted,textUpdated,unchanged,embedWritten,nextCursor,error}'

echo "[2/2] Retrieve sanity query"
jq -n \
  --arg q "Next.js routing" \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  --arg nsMode "prefix" \
  --argjson topK 5 \
  --argjson candidateK 200 \
  --argjson minSimilarity 0 \
  '{q:$q, ns:$ns, slot:$slot, nsMode:$nsMode, topK:$topK, candidateK:$candidateK, minSimilarity:$minSimilarity}' \
  | curl -sS -X POST "$BASE/api/retrieve" \
      -H "content-type: application/json" \
      --data-binary @- \
  | jq '{items:[.items[0,1]], filterInfo, debugVersion}'
