#!/usr/bin/env bash
set -euo pipefail

# === Конфиг по умолчанию (можно переопределять переменными окружения) ===
APP="${APP:-$HOME/projects/freya-rebecca/apps/web}"
BASE="${BASE:-http://localhost:3000}"
NS="${NS:-rebecca/army/refs}"
SLOT="${SLOT:-staging}"
OWNER="${OWNER:-}"           # например: openai
REPO="${REPO:-}"            # например: openai-cookbook
LIMIT="${LIMIT:-200}"        # сколько путей обрабатываем за один проход
SLEEP_ON_429="${SLEEP_ON_429:-15}" # пауза при rate limit, сек

# === Админ-ключ из .env.local ===
if [[ ! -f "$APP/.env.local" ]]; then
  echo "ERROR: $APP/.env.local not found" >&2
  exit 1
fi
ADM_VALUE="$(grep -E '^X_ADMIN_KEY=' "$APP/.env.local" | cut -d= -f2- || true)"
if [[ -z "${ADM_VALUE:-}" ]]; then
  echo "ERROR: X_ADMIN_KEY is empty in $APP/.env.local" >&2
  exit 1
fi
ADM_HEADER="x-admin-key: $ADM_VALUE"

cursor=0

echo ">>> Backfilling published_at:"
echo "    BASE=$BASE"
echo "    NS=$NS SLOT=$SLOT OWNER=${OWNER:-<any>} REPO=${REPO:-<any>} LIMIT=$LIMIT"

while true; do
  # Формируем тело запроса
  body=$(jq -n --arg ns "$NS" --arg slot "$SLOT" \
               --arg owner "$OWNER" --arg repo "$REPO" \
               --argjson limit "$LIMIT" --argjson cursor "$cursor" '
    {
      ns:$ns, slot:$slot, limit:$limit
    }
    + (if $owner != "" then {owner:$owner} else {} end)
    + (if $repo  != "" then {repo:$repo}  else {} end)
    + (if $cursor > 0 then {cursor:$cursor} else {} end)
  ')

  # Запрос
  resp="$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/maint/github-published-at" \
    -H 'Content-Type: application/json' -H "$ADM_HEADER" \
    --data "$body")"

  # Отделяем JSON и код статуса
  http_code="$(echo "$resp" | tail -n1)"
  json="$(echo "$resp" | sed '$d')"

  # Рейтлимиты/ошибки HTTP
  if [[ "$http_code" != "200" ]]; then
    echo "HTTP $http_code:" >&2
    echo "$json" | jq . >&2 || echo "$json" >&2
    if [[ "$http_code" == "429" || "$http_code" == "403" ]]; then
      echo "Hit rate limit, sleep ${SLEEP_ON_429}s ..." >&2
      sleep "$SLEEP_ON_429"
      continue
    fi
    exit 1
  fi

  # Выводим прогресс по текущей странице
  echo "$json" | jq . || echo "$json"

  # Забираем nextCursor и решаем, продолжать ли цикл
  next="$(echo "$json" | jq -r '.nextCursor // empty')"
  if [[ -z "$next" || "$next" == "null" ]]; then
    echo ">>> Done (no nextCursor)."
    break
  fi
  cursor="$next"
done
