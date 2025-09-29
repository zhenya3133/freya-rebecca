#!/usr/bin/env bash
# Smoke: создаёт тестовый PDF, триггерит ingest, проверяет retrieve
set -euo pipefail

: "${BASE:=http://localhost:3000}"
: "${NS:=rebecca/army/refs}"
: "${SLOT:=staging}"
: "${WINDOWS_INGEST_DIR:=/mnt/f/Rebecca_Ingest}"

IN_DIR="${WINDOWS_INGEST_DIR}/in"
OUT_DIR="${WINDOWS_INGEST_DIR}/out"

echo "[smoke] BASE=$BASE NS=$NS SLOT=$SLOT"
echo "[smoke] IN_DIR=$IN_DIR"
echo "[smoke] OUT_DIR=$OUT_DIR"

mkdir -p "$IN_DIR" "$OUT_DIR"

# 1) Создаём тестовый PDF и кидаем в IN
echo "Smoke test PDF for Desktop ingest pipeline. Contains the word arxiv for search." > /tmp/smoke.md
pandoc /tmp/smoke.md -o "$IN_DIR/smoke.pdf"
echo "[smoke] dropped $IN_DIR/smoke.pdf"

# 2) Явно запускаем ingest (на случай если watcher не запущен)
NS="$NS" SLOT="$SLOT" BASE="$BASE" \
X_ADMIN_KEY="${X_ADMIN_KEY:?need X_ADMIN_KEY}" \
WINDOWS_INGEST_DIR="$WINDOWS_INGEST_DIR" \
bash ./apps/web/scripts/ingest_from_desktop.sh

# 3) Проверяем артефакты
echo "[smoke] seed_result.json:"
if [ -f "$OUT_DIR/seed_result.json" ]; then
  jq '.' "$OUT_DIR/seed_result.json" | sed -n '1,20p'
else
  echo "seed_result.json not found"
fi

echo "[smoke] embed_backfill.log (last lines):"
if [ -f "$OUT_DIR/embed_backfill.log" ]; then
  tail -n 20 "$OUT_DIR/embed_backfill.log"
else
  echo "embed_backfill.log not found"
fi

# 4) Мини-поиск
echo "[smoke] retrieve arxiv:"
jq -n --arg q 'arxiv' --arg ns "$NS" --arg slot "$SLOT" \
  '{q:$q, ns:$ns, slot:$slot, nsMode:"exact", topK:5, candidateK:200, minSimilarity:0}' \
| curl -sS -X POST "$BASE/api/retrieve" -H 'content-type: application/json' --data-binary @- \
| jq '.items[0:5] | map({score, title, url})'
