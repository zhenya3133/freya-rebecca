#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   scripts/ingest_github_paged.sh OWNER REPO NS SLOT [REF] [LIMIT] [INCLUDE_EXT_JSON]
# Example:
#   scripts/ingest_github_paged.sh NirDiamant agents-towards-production rebecca/army/refs staging main 250 '[".md",".mdx",".py",".ipynb",".txt",".ts",".tsx"]'

OWNER="${1:-openai}"
REPO="${2:-openai-cookbook}"
NS="${3:-rebecca/army/refs}"
SLOT="${4:-staging}"
REF="${5:-main}"
LIMIT="${6:-250}"
INCLUDE_EXT_JSON="${7:-[".md",".mdx",".py",".ipynb",".txt"]}"

APP=~/projects/freya-rebecca/apps/web
BASE=http://localhost:3000
ADM="x-admin-key: $(grep -E '^X_ADMIN_KEY=' "$APP/.env.local" | cut -d= -f2-)"

# checkpoint для продолжения с места остановки
CKPT_DIR="$APP/.ingest_checkpoints"
mkdir -p "$CKPT_DIR"
CKPT="$CKPT_DIR/${OWNER}_${REPO}_${REF}.cursor"

if [[ -f "$CKPT" ]]; then
  CURSOR=$(cat "$CKPT")
else
  CURSOR=0
fi

echo ">>> Ingest $OWNER/$REPO@$REF into ns=$NS slot=$SLOT (limit=$LIMIT) from cursor=$CURSOR"
TOTAL=""
PAGE=0

while true; do
  REQ=$(jq -n \
    --arg ns "$NS" --arg slot "$SLOT" \
    --arg owner "$OWNER" --arg repo "$REPO" --arg ref "$REF" \
    --argjson cursor $CURSOR --argjson limit $LIMIT \
    --argjson includeExt "$INCLUDE_EXT_JSON" \
    '{ns:$ns,slot:$slot,owner:$owner,repo:$repo,ref:$ref,includeExt:$includeExt,cursor:$cursor,limit:$limit}')

  RESP=$(curl -sS -X POST "$BASE/api/ingest/github" \
    -H 'Content-Type: application/json' -H "$ADM" \
    --data-binary "$REQ")

  OK=$(echo "$RESP" | jq -r '.ok')
  if [[ "$OK" != "true" ]]; then
    echo "$RESP" | jq .
    echo "!!! error, stopping"
    exit 1
  fi

  TOTAL=$(echo "$RESP" | jq -r '.totalFiles')
  WINDOW_START=$(echo "$RESP" | jq -r '.windowStart')
  WINDOW_END=$(echo "$RESP" | jq -r '.windowEnd')
  PAGE_FILES=$(echo "$RESP" | jq -r '.pageFiles')
  CHUNKS=$(echo "$RESP" | jq -r '.chunks')
  WRITTEN=$(echo "$RESP" | jq -r '.written')
  MS=$(echo "$RESP" | jq -r '.ms')
  NEXT=$(echo "$RESP" | jq -r '.nextCursor')

  PAGE=$((PAGE+1))
  echo "page #$PAGE files [$WINDOW_START..$WINDOW_END] pageFiles=$PAGE_FILES chunks=$CHUNKS written=$WRITTEN time=${MS}ms"

  if [[ "$NEXT" != "null" && -n "$NEXT" ]]; then
    echo -n "$NEXT" > "$CKPT"
    CURSOR="$NEXT"
    sleep 1
  else
    rm -f "$CKPT"
    echo ">>> Done. totalFiles=$TOTAL"
    break
  fi
done
