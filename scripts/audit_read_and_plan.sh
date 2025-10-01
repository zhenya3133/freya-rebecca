#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.."; pwd)"
JSON="${1:-/tmp/rebecca_audit.json}"

if [[ ! -f "$JSON" ]]; then
  echo "ERROR: $JSON not found. Сначала прогоняй scripts/audit_everything.sh" >&2
  exit 1
fi

# короткая функция: печать секции
section(){ printf "\n=== %s ===\n" "$1"; }

# 0) общая шапка
TS=$(jq -r '.timestamp' "$JSON")
BASE=$(jq -r '.base' "$JSON")
NS=$(jq -r '.ns' "$JSON")
SLOT=$(jq -r '.slot' "$JSON")
echo "AUDIT READ @ $TS"
echo "BASE=$BASE  NS=$NS  SLOT=$SLOT"
echo "SRC: $JSON"

# 1) API-роуты и наличие файлов
section "API / Files"
jq -r '
  .files
  | to_entries
  | sort_by(.key)
  | map( .key + "\t" + .value.present + "\t" + .value.path )
  | ["route\tpresent\tpath"] + .
  | .[]
' "$JSON" | column -t -s$'\t'

ROUTES_COUNT=$(jq -r '.files_meta.routes_count // "?"' "$JSON")
echo "routes_count: $ROUTES_COUNT"

# 2) Состояние API-эндпоинтов (smoke)
section "API smoke payloads (truncated)"
jq -r '
  .api
  | to_entries
  | sort_by(.key)
  | .[]
  | .key as $k
  | ( try (.value.ok) catch null ) as $ok
  | ($k + ": ok=" + ( ($ok|tostring) // "n/a" ))
' "$JSON"

# 3) БД: таблицы, счётчики, аномалии
section "DB counts"
jq -r '
  .db.counts
  | to_entries
  | map(.key + "\t" + (.value|tostring))
  | ["metric\tvalue"] + .
  | .[]
' "$JSON" | column -t -s$'\t'

echo
echo "tables:"
jq -r '.db.tables[]?' "$JSON" | sed 's/^/  - /' || true

echo
echo "per ns/slot:"
jq -r '.db.per_ns[]? | "\(.ns)\t\(.slot)\t\(.docs)\t\(.chunks)"' "$JSON" \
  | awk 'BEGIN{print "ns\tslot\tdocs\tchunks"}{print}' | column -t -s$'\t' || true

# 4) Импорт-граф: размер
section "Imports graph"
jq -r '.imports | "files=" + ((.files//0)|tostring) + "  edges=" + ((.edges//0)|tostring)' "$JSON"

# 5) Пакеты (просто отметим наличие слепка)
section "Deps"
jq -r '.deps.package_json as $p | "package.json snapshot: " + (if $p==1 then "present" else "missing" end)' "$JSON"

# 6) Автоматические флаги/риски
section "Flags & Risks"
EMB_DIM=$(jq -r '.db.counts.vector_dims // 0' "$JSON")
# Попробуем вытащить ожидаемые dims из docs/deps или ENV (если audit_everything его туда положит позже — сейчас просто nil)
EXP_DIM=$(grep -E '^EMBED_DIMS=' "$ROOT/apps/web/.env.local" 2>/dev/null | cut -d= -f2 | tr -d '\r' || true)

DOCS=$(jq -r '.db.counts.docs // 0' "$JSON")
CHUNKS=$(jq -r '.db.counts.chunks // 0' "$JSON")
EMBED=$(jq -r '.db.counts.embedded // 0' "$JSON")
ORPH=$(jq -r '.db.counts.orphan_chunks // 0' "$JSON")

[[ "$DOCS" -eq 0 || "$CHUNKS" -eq 0 ]] && echo "❗ В БД мало данных: docs=$DOCS chunks=$CHUNKS — проверяем пайплайн инжеста."
[[ "$ORPH" -gt 0 ]] && echo "❗ Есть осиротевшие чанки: orphan_chunks=$ORPH — нужно починить внешний ключ/clean-up."
if [[ -n "$EXP_DIM" && "$EMB_DIM" -gt 0 && "$EXP_DIM" != "$EMB_DIM" ]]; then
  echo "❗ Несовпадение размерности эмбеддингов: БД=$EMB_DIM vs ENV=$EXP_DIM — пересчитать эмбеддинги."
fi
[[ "$EMBED" -eq 0 && "$CHUNKS" -gt 0 ]] && echo "❗ Чанков есть, но эмбеддингов нет — прогоняй backfill."
[[ "$(jq -r '.files.youtube.present' "$JSON")" == "yes" ]] && echo "ℹ️ YouTube route присутствует (у нас на нём заглушка — ок)."

# 7) Итоговый приоритетный TODO (формируется от фактов)
section "Priority TODO (from audit)"
{
  ok_env=$(jq -r '.api.debug_env.ok // empty' "$JSON")
  ok_ret=$(jq -r '.api.retrieve_ping.ok // empty' "$JSON")
  echo "- Проверить окружение через /api/debug/env: $([[ "$ok_env" == "true" ]] && echo OK || echo "НЕ ОК")"
  echo "- Проверить retrieve: $([[ "$ok_ret" == "true" ]] && echo OK || echo "НЕ ОК")"
  if [[ "$ORPH" -gt 0 ]]; then
    echo "- Удалить осиротевшие чанки (SQL cleanup)."
  fi
  if [[ -n "$EXP_DIM" && "$EMB_DIM" -gt 0 && "$EXP_DIM" != "$EMB_DIM" ]]; then
    echo "- Переиндексировать эмбеддинги под EMBED_DIMS=$EXP_DIM."
  fi
  if [[ "$EMBED" -eq 0 && "$CHUNKS" -gt 0 ]]; then
    echo "- Запустить apps/web/scripts/embed_backfill.sh '$NS' '$SLOT'."
  fi
} | sed 's/^/  /'
