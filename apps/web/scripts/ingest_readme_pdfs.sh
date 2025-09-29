#!/usr/bin/env bash
set -euo pipefail

APP="${APP:-$HOME/projects/freya-rebecca/apps/web}"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
OWNER="${OWNER:?-- set OWNER}"
REPO="${REPO:?-- set REPO}"
REF="${REF:-main}"
LIMIT="${LIMIT:-30}"              # сколько URL отправлять за 1 запрос
MAX_FILE_BYTES="${MAX_FILE_BYTES:-20000000}"

# заголовок admin
if [[ -z "${ADM:-}" ]]; then
  if [[ -f "$APP/.env.local" ]]; then
    ADM="x-admin-key: $(grep -E '^X_ADMIN_KEY=' "$APP/.env.local" | cut -d= -f2- || true)"
  fi
fi
[[ -z "${ADM:-}" ]] && { echo "!! ADM not set"; exit 1; }

echo ">>> Read README for $OWNER/$REPO@$REF ..."
readme_json="$(curl -fsS "https://api.github.com/repos/$OWNER/$REPO/contents/README.md?ref=$REF")"
content_b64="$(jq -r '.content // empty' <<<"$readme_json")"
[[ -z "$content_b64" ]] && { echo "No README.md content"; exit 0; }
readme_txt="$(printf '%s' "$content_b64" | tr -d '\n' | base64 -d)"

# добываем все http(s) ссылки и фильтруем pdf
mapfile -t pdfs < <(printf '%s\n' "$readme_txt" | \
  grep -oE '(https?://[^ )>\"]+)' | \
  sed 's/[),.;:]*$//' | \
  grep -iE '\.pdf($|\?)' | sort -u)

echo "found PDF links: ${#pdfs[@]}"
((${#pdfs[@]}==0)) && exit 0

# пачками шлём в /api/ingest/url
cursor=0
while (( cursor < ${#pdfs[@]} )); do
  batch=( "${pdfs[@]:$cursor:$LIMIT}" )
  cursor=$((cursor + ${#batch[@]} ))

  printf '>>> Batch of %d\n' "${#batch[@]}"

  # собираем JSON-массив
  urls_json="$(printf '%s\n' "${batch[@]}" | jq -R . | jq -s .)"

  curl -fsS -X POST "$BASE/api/ingest/url" \
    -H 'Content-Type: application/json' -H "$ADM" \
    --data-binary "$(jq -n \
      --arg ns "$NS" \
      --arg slot "$SLOT" \
      --argjson urls "$urls_json" \
      --argjson maxFileBytes "$MAX_FILE_BYTES" \
      '{ns:$ns,slot:$slot,urls:$urls,maxFileBytes:$maxFileBytes}')"
  echo
done

echo ">>> Done."
