# apps/web/scripts/ingest_github_paged.sh
#!/usr/bin/env bash
set -euo pipefail

# --- Defaults ---
APP="${APP:-$HOME/projects/freya-rebecca/apps/web}"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
OWNER=""
REPO=""
REF="main"
PATH_PREFIX=""
INCLUDE_LIST=""    # ".md,.mdx,.py,.ipynb,.txt,.ts,.tsx"
EXCLUDE_LIST=""    # optional
LIMIT=200
CURSOR=0
DRYRUN="false"
NOEMB="false"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") --ns NS --slot SLOT --owner OWNER --repo REPO [--ref main] [--path subdir]
                   [--include ".md,.mdx,.py,.ipynb,.txt"] [--exclude ".png,.pdf"]
                   [--limit 200] [--cursor 0] [--dry-run] [--no-emb]
Env:
  APP  (default: $APP)
  BASE (default: $BASE)
  ADM  (x-admin-key; auto-read from \$APP/.env.local if empty)
EOF
}

# --- Args ---
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
    --no-emb) NOEMB="true"; shift 1;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

# --- Admin header ---
if [[ -z "${ADM:-}" ]]; then
  if [[ -f "$APP/.env.local" ]]; then
    ADM="x-admin-key: $(grep -E '^X_ADMIN_KEY=' "$APP/.env.local" | cut -d= -f2- || true)"
  fi
fi
if [[ -z "${ADM:-}" ]]; then
  echo "!! ADM (x-admin-key) not found. Export ADM or put X_ADMIN_KEY in $APP/.env.local"
  exit 1
fi

# --- Normalize include/exclude into JSON arrays (strings -> ["a","b"]) ---
include_json="null"
exclude_json="null"
if [[ -n "$INCLUDE_LIST" ]]; then
  include_json=$(jq -nc --arg s "$INCLUDE_LIST" '$s|split(",")|map(.|gsub("^\\s+|\\s+$";""))')
fi
if [[ -n "$EXCLUDE_LIST" ]]; then
  exclude_json=$(jq -nc --arg s "$EXCLUDE_LIST" '$s|split(",")|map(.|gsub("^\\s+|\\s+$";""))')
fi

echo ">>> Ingest: ns=$NS slot=$SLOT owner=$OWNER repo=$REPO ref=$REF limit=$LIMIT from cursor=$CURSOR dryRun=$DRYRUN noEmb=$NOEMB"
echo "    BASE=$BASE APP=$APP"
echo "    include=$INCLUDE_LIST exclude=$EXCLUDE_LIST"
echo

# --- checkpoint ---
CKPT_DIR="$APP/.ingest_checkpoints"
mkdir -p "$CKPT_DIR"
CKPT="$CKPT_DIR/${OWNER}_${REPO}_${REF}.cursor"
if [[ "$CURSOR" == "0" && -f "$CKPT" ]]; then
  CURSOR="$(cat "$CKPT")"
fi

next="$CURSOR"
total_inserted=0
total_updated=0
total_unchanged=0
total_chunks=0
total_emb=0
page=0

while :; do
  # 1) базовый payload (только обязательные поля и числа как числа)
  payload=$(jq -n \
    --arg ns "$NS" --arg slot "$SLOT" \
    --arg owner "$OWNER" --arg repo "$REPO" --arg ref "$REF" \
    --argjson cursor "$next" --argjson limit "$LIMIT" \
    '{ns:$ns,slot:$slot,owner:$owner,repo:$repo,ref:$ref,cursor:$cursor,limit:$limit}')

  # 2) необязательные поля добавляем ПО ОДНОМУ, чтобы не городить jq-программу
  if [[ -n "$PATH_PREFIX" ]]; then
    payload=$(echo "$payload" | jq --arg path "$PATH_PREFIX" '. + {path:$path}')
  fi
  if [[ "$include_json" != "null" ]]; then
    payload=$(echo "$payload" | jq --argjson include "$include_json" '. + {includeExt:$include}')
  fi
  if [[ "$exclude_json" != "null" ]]; then
    payload=$(echo "$payload" | jq --argjson exclude "$exclude_json" '. + {excludeExt:$exclude}')
  fi
  if [[ "$DRYRUN" == "true" ]]; then
    payload=$(echo "$payload" | jq '. + {dryRun:true}')
  fi
  if [[ "$NOEMB" == "true" ]]; then
    payload=$(echo "$payload" | jq '. + {skipEmbeddings:true}')
  fi

  # 3) запрос
  resp=$(curl -sS -X POST "$BASE/api/ingest/github" \
    -H 'Content-Type: application/json' -H "$ADM" \
    --data-binary "$payload")

  ok=$(echo "$resp" | jq -r '.ok // false')
  if [[ "$ok" != "true" ]]; then
    echo "$resp" | jq .; echo "!! Error, stopping."
    exit 1
  fi

  page=$((page+1))
  totalFiles=$(echo "$resp" | jq -r '.totalFiles')
  windowStart=$(echo "$resp" | jq -r '.windowStart')
  windowEnd=$(echo "$resp" | jq -r '.windowEnd')
  pageFiles=$(echo "$resp" | jq -r '.pageFiles')
  textChunks=$(echo "$resp" | jq -r '.textChunks // 0')
  inserted=$(echo "$resp" | jq -r '.textInserted // 0')
  updated=$(echo "$resp" | jq -r '.textUpdated // 0')
  same=$(echo "$resp" | jq -r '.unchanged // 0')
  embw=$(echo "$resp" | jq -r '.embedWritten // 0')
  ms=$(echo "$resp" | jq -r '.ms')
  next=$(echo "$resp" | jq -r '.nextCursor')

  total_chunks=$((total_chunks + textChunks))
  total_inserted=$((total_inserted + inserted))
  total_updated=$((total_updated + updated))
  total_unchanged=$((total_unchanged + same))
  total_emb=$((total_emb + embw))

  echo ">>> Page #$page  files[$windowStart..$windowEnd] pageFiles=$pageFiles  chunks=$textChunks  ins=$inserted upd=$updated same=$same emb=$embw  time=${ms}ms"

  if [[ "$next" != "null" && -n "$next" ]]; then
    printf "%s" "$next" > "$CKPT"
    sleep 1
  else
    rm -f "$CKPT"
    echo ">>> Done. totalFiles=$totalFiles pages=$page chunks=$total_chunks ins=$total_inserted upd=$total_updated same=$total_unchanged emb=$total_emb"
    exit 0
  fi
done
