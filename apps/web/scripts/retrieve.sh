#!/usr/bin/env bash
set -euo pipefail

# Использование:
#   ./scripts/retrieve.sh "HTTP methods" rebecca/army/refs staging 5 200
#   ./scripts/retrieve.sh --lite "HTTP" rebecca/army/refs staging 5 100
#   ./scripts/retrieve.sh --max 300 "HTTP methods" rebecca/army/refs staging 5 200
#
# Требуется:
#   BASE=http://localhost:3000

LITE=false
MAX_CHARS=0

# Флаги: --lite, --max N
while [[ $# -gt 0 ]]; do
  case "$1" in
    --lite) LITE=true; shift ;;
    --max)
      shift
      [[ $# -gt 0 ]] || { echo "Expected number after --max" >&2; exit 2; }
      MAX_CHARS="$1"; shift ;;
    *) break ;;
  esac
done

: "${BASE:?need BASE like http://localhost:3000}"

Q="${1:?need query string}"
NS="${2:?need ns}"
SLOT="${3:?need slot}"
TOP="${4:-5}"
CAND="${5:-200}"

# Формируем include как JSON-массив через jq (без ручных кавычек)
if [[ "$LITE" == true ]]; then
  INCLUDE_JSON='["url","title","score"]'
else
  INCLUDE_JSON='["url","title","content","score"]'
fi

REQ="$(jq -n \
  --arg q "$Q" \
  --arg ns "$NS" \
  --arg slot "$SLOT" \
  --argjson top "$TOP" \
  --argjson cand "$CAND" \
  --argjson include "$INCLUDE_JSON" \
'{
  q: $q,
  ns: $ns,
  slot: $slot,
  nsMode: "prefix",
  topK: $top,
  candidateK: $cand,
  minSimilarity: 0,
  include: $include,
  debugVersion: true
}')"

echo -e "\n--- REQUEST ---"
echo "$REQ" | jq .

# Запрос: тело в файл, статус в переменную
OUT="$(mktemp)"
STATUS="$(curl -sS -o "$OUT" -w "%{http_code}" -X POST "$BASE/api/retrieve" \
  -H "content-type: application/json" \
  --data-binary @<(echo "$REQ"))"

echo -e "\n--- RESPONSE (HTTP $STATUS) ---"
cat "$OUT" | head -c 1000;  # показываем начало для наглядности
echo

if [[ "$STATUS" != "200" ]]; then
  echo -e "\nRequest failed with HTTP $STATUS. Raw body above."
  exit 1
fi

# Проверяем, что это объект с полем items
if ! jq -e 'type=="object" and has("items")' "$OUT" >/dev/null 2>&1; then
  echo -e "\nUnexpected response (no .items). Raw body:"
  cat "$OUT"
  exit 2
fi

# Парсинг и опциональная обрезка контента
if [[ "$LITE" == true ]]; then
  jq '{top: (.items|length), items: [.items[] | {score, url, title}]}' "$OUT"
else
  if [[ "$MAX_CHARS" -gt 0 ]]; then
    jq --argjson max "$MAX_CHARS" \
      '{top: (.items|length), items: [.items[] | {score, url, title, content: (.content|tostring|.[0:$max])}]}' "$OUT"
  else
    jq '{top: (.items|length), items: [.items[] | {score, url, title}]}' "$OUT"
  fi
fi

rm -f "$OUT"
