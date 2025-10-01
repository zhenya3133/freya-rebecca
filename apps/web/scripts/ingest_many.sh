#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/ingest_many.sh rebecca/army/refs staging urls.txt
#   ./scripts/ingest_many.sh rebecca/army/refs staging urls.txt --dry --no-emb
#
# Требуется окружение:
#   BASE         (например http://localhost:3000)
#   ADMIN_KEY    (или X_ADMIN_KEY — наш assertAdmin принимает оба)
#
# Формат urls.txt: по одному URL на строку, пустые и #комментарии игнорируются.

: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY or set X_ADMIN_KEY and export ADMIN_KEY=...}"

NS="${1:?need ns}"
SLOT="${2:?need slot}"
LIST="${3:?need path to file with URLs}"

DRY=false
NOEMB=false
shift 3 || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=true ;;
    --no-emb) NOEMB=true ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

mapfile -t URLS < <(grep -vE '^\s*(#|$)' "$LIST" | sed 's/\r$//')
if [[ ${#URLS[@]} -eq 0 ]]; then
  echo "No URLs found in $LIST" >&2
  exit 1
fi

# Грузим пачками по 10, чтобы не спамить сеть/модель
BATCH=10
i=0
while [[ $i -lt ${#URLS[@]} ]]; do
  CHUNK=( "${URLS[@]:$i:$BATCH}" )
  i=$(( i + BATCH ))

  jq -n --arg ns "$NS" --arg slot "$SLOT" \
        --argjson dry "$([[ "$DRY" == true ]] && echo true || echo false)" \
        --argjson noemb "$([[ "$NOEMB" == true ]] && echo true || echo false)" \
        --argjson urls "$(printf '%s\n' "${CHUNK[@]}" | jq -R . | jq -s .)" \
'{
  ns: $ns,
  slot: $slot,
  urls: $urls,
  dryRun: $dry,
  skipEmbeddings: $noemb
}' | curl -fsS -X POST "$BASE/api/ingest/url" \
     -H "content-type: application/json" \
     -H "x-admin-key: $ADMIN_KEY" \
     --data-binary @- \
  | jq '{ok, ns, slot, dryRun, skipEmbeddings, textChunks, textInserted, textUpdated, unchanged, embedWritten, ms}'
done
