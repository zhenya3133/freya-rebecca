#!/usr/bin/env bash
set -euo pipefail

# Локальный смок-тест RC-v1 для Freya/Rebecca.
# Проверяет:
#  1) /api/db-ping
#  2) /api/admin/sql (SELECT 1) с ADMIN_KEY
#  3) /api/retrieve (на ns/slot из БД) — что отдаёт items[]
#
# Требования окружения:
#   BASE         — http://localhost:3000
#   ADMIN_KEY    — dev-12345  (как в .env.local)
#
# Необязательно, но полезно:
#   RETRIEVE_NS       — например "rebecca/army/refs"
#   RETRIEVE_SLOT     — например "staging"
#   RETRIEVE_QUERY    — строка запроса (по умолчанию "HTTP")
#   RETRIEVE_TOPK     — по умолчанию 3
#   RETRIEVE_CANDK    — по умолчанию 100
#
# Пример запуска:
#   export BASE="http://localhost:3000"
#   export ADMIN_KEY="dev-12345"
#   ./scripts/ci_smoke.sh
#
# Код завершения !=0 при любой ошибке.

: "${BASE:?need BASE like http://localhost:3000}"
: "${ADMIN_KEY:?need ADMIN_KEY (dev-12345)}"

RETRIEVE_NS="${RETRIEVE_NS:-}"
RETRIEVE_SLOT="${RETRIEVE_SLOT:-}"
RETRIEVE_QUERY="${RETRIEVE_QUERY:-HTTP}"
RETRIEVE_TOPK="${RETRIEVE_TOPK:-3}"
RETRIEVE_CANDK="${RETRIEVE_CANDK:-100}"

say() { printf "\n\033[1;36m[SMOKE]\033[0m %s\n" "$*"; }
fail() { printf "\n\033[1;31m[FAIL]\033[0m %s\n" "$*"; exit 1; }

# 1) db-ping
say "1) GET $BASE/api/db-ping"
PING_JSON="$(curl -fsS "$BASE/api/db-ping" || true)"
echo "$PING_JSON" | jq .
echo "$PING_JSON" | jq -e '.ok == true' >/dev/null || fail "/api/db-ping not ok"

# 2) admin sql: SELECT 1
say "2) POST $BASE/api/admin/sql (SELECT 1)"
jq -n '{ sql: "SELECT 1 AS ok" }' \
| curl -fsS -X POST "$BASE/api/admin/sql" \
  -H "content-type: application/json" \
  -H "x-admin-key: $ADMIN_KEY" \
  --data-binary @- | tee /tmp/smoke_sql.json >/dev/null

cat /tmp/smoke_sql.json | jq -e '.ok == true' >/dev/null || fail "admin sql not ok"
cat /tmp/smoke_sql.json | jq -e '.rows[0].ok == 1' >/dev/null || fail "admin sql rows mismatch"

# 2.1) Если ns/slot не заданы, узнаем топовые из БД
if [[ -z "$RETRIEVE_NS" || -z "$RETRIEVE_SLOT" ]]; then
  say "2.1) Fetch top ns/slot from DB"
  jq -n '{"sql":"SELECT ns, slot, COUNT(*) AS cnt FROM chunks GROUP BY ns, slot ORDER BY cnt DESC LIMIT 1;"}' \
  | curl -fsS -X POST "$BASE/api/admin/sql" \
    -H "content-type: application/json" \
    -H "x-admin-key: $ADMIN_KEY" \
    --data-binary @- > /tmp/smoke_ns.json

  cat /tmp/smoke_ns.json | jq -e '.ok == true' >/dev/null || fail "cannot select ns/slot"
  RETRIEVE_NS="$(cat /tmp/smoke_ns.json | jq -r '.rows[0].ns')"
  RETRIEVE_SLOT="$(cat /tmp/smoke_ns.json | jq -r '.rows[0].slot')"

  [[ -n "$RETRIEVE_NS" && -n "$RETRIEVE_SLOT" ]] || fail "ns/slot empty"
  say "Using ns='$RETRIEVE_NS', slot='$RETRIEVE_SLOT'"
fi

# 3) retrieve
say "3) POST $BASE/api/retrieve (q='$RETRIEVE_QUERY')"
jq -n --arg q "$RETRIEVE_QUERY" --arg ns "$RETRIEVE_NS" --arg slot "$RETRIEVE_SLOT" \
      --argjson topK "$RETRIEVE_TOPK" --argjson candK "$RETRIEVE_CANDK" \
'{
  q: $q,
  ns: $ns,
  slot: $slot,
  nsMode: "prefix",
  topK: $topK,
  candidateK: $candK,
  minSimilarity: 0,
  include: ["url","title","content","score"],
  debugVersion: true
}' \
| curl -fsS -X POST "$BASE/api/retrieve" \
  -H "content-type: application/json" \
  --data-binary @- > /tmp/smoke_retrieve.json

cat /tmp/smoke_retrieve.json | jq '.items | length'
cat /tmp/smoke_retrieve.json | jq -e '.items | length >= 1' >/dev/null || fail "retrieve returned no items"

say "SMOKE OK ✅"
