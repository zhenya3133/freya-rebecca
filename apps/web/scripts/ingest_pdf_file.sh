#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/ingest_pdf_file.sh NS SLOT /abs/path/to/file.pdf           # обычная загрузка
#   ./scripts/ingest_pdf_file.sh NS SLOT /abs/path/to/file.pdf --dry     # dry-run
#   ./scripts/ingest_pdf_file.sh NS SLOT /abs/path/to/file.pdf --no-emb  # без эмбеддингов
#   ./scripts/ingest_pdf_file.sh NS SLOT /abs/path/to/file.pdf --chars 1200 --overlap 180
# Требуется окружение: BASE, ADMIN_KEY (как для остальных скриптов)

: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY}"

NS="${1:?need ns}"
SLOT="${2:?need slot}"
PDF_PATH="${3:?need absolute path to local PDF}"
shift 3 || true

if [[ ! -f "$PDF_PATH" ]]; then
  echo "File not found: $PDF_PATH" >&2
  exit 1
fi

DRY=false
NOEMB=false
MAXBYTES=0
CHARS=0
OVERLAP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=true ;;
    --no-emb) NOEMB=true ;;
    --max) shift; MAXBYTES="${1:?need number}" ;;
    --chars) shift; CHARS="${1:?need number}" ;;
    --overlap) shift; OVERLAP="${1:?need number}" ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
  shift || true
done

make_chunk_json() {
  local c="$1" o="$2"
  jq -n --argjson c "${c:-0}" --argjson o "${o:-0}" '
    (if $c>0 then {chars:$c} else {} end)
    + (if $o>0 then {overlap:$o} else {} end)
  '
}

CHUNK_JSON="$(make_chunk_json "$CHARS" "$OVERLAP")"
URL="file://$PDF_PATH"

jq -n \
  --arg ns "$NS" --arg slot "$SLOT" --arg url "$URL" \
  --argjson dry "$([[ "$DRY" == true ]] && echo true || echo false)" \
  --argjson noemb "$([[ "$NOEMB" == true ]] && echo true || echo false)" \
  --argjson max "$MAXBYTES" \
  --argjson chunk "$CHUNK_JSON" '
  { ns: $ns, slot: $slot, url: $url, dryRun: $dry, skipEmbeddings: $noemb }
  | ( if ($max|tonumber) > 0 then . + { maxFileBytes: ($max|tonumber) } else . end )
  | ( if ( ($chunk|type)=="object" and ($chunk|length)>0 ) then . + { chunk: $chunk } else . end )
' \
| curl -fsS -X POST "$BASE/api/ingest/pdf" \
  -H "content-type: application/json" -H "x-admin-key: $ADMIN_KEY" \
  --data-binary @- \
| jq '{ok, ns, slot, url, dryRun, pages, textChunks, textInserted, textUpdated, unchanged, embedWritten, ms}'
