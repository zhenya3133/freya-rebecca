#!/usr/bin/env bash
set -euo pipefail

# Defaults
APP="${APP:-$HOME/projects/freya-rebecca/apps/web}"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
OWNER=""
REPO=""
REF="main"
PATH_PREFIX=""
INCLUDE_LIST=""   # e.g. ".md,.mdx,.py,.ipynb,.txt"
EXCLUDE_LIST=""   # optional
LIMIT=250
CURSOR=0
DRYRUN="false"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") --ns NS --slot SLOT --owner OWNER --repo REPO [--ref main] [--path subdir]
                   [--include ".md,.mdx,.py,.ipynb,.txt"] [--exclude ".png,.pdf"]
                   [--limit 250] [--cursor 0] [--dry-run]

Env:
  APP (default: $APP)
  BASE (default: $BASE)
  ADM  (x-admin-key header; auto-read from \$APP/.env.local if пусто)

Скрипт шагает по страницам (cursor -> nextCursor) до конца.
EOF
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ns) NS="$2"; shift 2;;
    --slot) SLOT="$2"; shift 2;;
    --owner) OWNER="$2"; shift 2;;
    --repo) REPO="$2"; shift 2;;
    --ref) REF="$2"; shift 2;;
    --path) PATH_PREFIX="$2"; shift 2;;
    --include) INCLUDE_LIST="$2"; shift 2;;
    --exclude) EXCLUDE_LIST="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    --cursor) CURSOR="$2"; shift 2;;
    --dry-run) DRYRUN="true"; shift 1;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1"; usage; exit 1;;
  end esac
done

# Admin header
if [[ -z "${ADM:-}" ]]; then
  if [[ -f "$APP/.env.local" ]]; then
    ADM="x-admin-key: $(grep -E '^X_ADMIN_KEY=' "$APP/.env.local" | cut -d= -f2- || true)"
  fi
fi
if [[ -z "$ADM" ]]; then
  echo "!! ADM (x-admin-key) не найден. Укажи переменную окружения ADM или положи X_ADMIN_KEY в $APP/.env.local"
  exit 1
fi

# Build JSON arrays for include/exclude safely
include_json="null"
exclude_json="null"
if [[ -n "$INCLUDE_LIST" ]]; then
  include_json=$(jq -nc --arg s "$INCLUDE_LIST" '$s | split(",")')
fi
if [[ -n "$EXCLUDE_LIST" ]]; then
  exclude_json=$(jq -nc --arg s "$EXCLUDE_LIST" '$s | split(",")')
fi

echo ">>> Ingest: ns=$NS slot=$SLOT owner=$OWNER repo=$REPO ref=$REF limit=$LIMIT from cursor=$CURSOR dryRun=$DRYRUN"
echo "    BASE=$BASE APP=$APP"
echo "    include=$INCLUDE_LIST exclude=$EXCLUDE_LIST"
echo

next="$CURSOR"
total_written=0
total_chunks=0
page=0

while :; do
  # Compose payload with jq to avoid quoting bugs
  payload=$(jq -nc \
    --arg ns "$NS" \
    --arg slot "$SLOT" \
    --arg owner "$OWNER" \
    --arg repo "$REPO" \
    --arg ref "$REF" \
    --arg path "$PATH_PREFIX" \
    --argjson include "$include_json" \
    --argjson exclude "$exclude_json" \
    --argjson cursor "$next" \
    --argjson limit "$LIMIT" \
    --argjson dryRun "$DRYRUN" \
    '{
      ns:$ns, slot:$slot, owner:$owner, repo:$repo,
      ref:$ref, path:$path,
      includeExt:$include, excludeExt:$exclude,
      cursor:$cursor, limit:$limit, dryRun:$dryRun
    }')

  resp=$(curl -sS -X POST "$BASE/api/ingest/github" \
    -H 'Content-Type: application/json' -H "$ADM" \
    --data-binary "$payload")

  ok=$(echo "$resp" | jq -r '.ok // false')
  if [[ "$ok" != "true" ]]; then
    echo "$resp" | jq .
    echo "!! Ошибка, прерываем."
    exit 1
  fi

  page=$((page+1))
  echo ">>> Page #$page"
  echo "$resp" | jq '{totalFiles,windowStart,windowEnd,pageFiles,chunks,written,nextCursor,ms}'
  written=$(echo "$resp" | jq -r '.written // 0')
  chunks=$(echo "$resp" | jq -r '.chunks // 0')
  total_written=$((total_written + written))
  total_chunks=$((total_chunks + chunks))

  next=$(echo "$resp" | jq -r '.nextCursor')
  if [[ "$next" == "null" || -z "$next" ]]; then
    echo ">>> Done. Total pages=$page, chunks=$total_chunks, written=$total_written"
    exit 0
  fi
done
