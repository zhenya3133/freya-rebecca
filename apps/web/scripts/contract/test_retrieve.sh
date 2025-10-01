#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"

pass() { echo "OK  - $1"; }
fail() { echo "FAIL- $1"; exit 1; }

# 1) valid body
valid='{"q":"ping","ns":"rebecca/army/refs","slot":"staging","topK":1,"candidateK":1,"minSimilarity":0,"nsMode":"strict"}'
resp_valid="$(curl -sS -X POST "$BASE/api/retrieve" -H 'content-type: application/json' -d "$valid")" || fail "valid POST failed (curl)"
echo "$resp_valid" | jq -e '.items != null' >/dev/null 2>&1 && pass "valid JSON accepted" || fail "valid JSON not accepted"

# 2) invalid body (нет q)
invalid='{"ns":"rebecca/army/refs","slot":"staging","topK":1}'
resp_invalid="$(curl -sS -X POST "$BASE/api/retrieve" -H 'content-type: application/json' -d "$invalid" || true)"
echo "$resp_invalid" | jq -e 'has("error")' >/dev/null 2>&1 && pass "invalid JSON rejected with error" || fail "invalid JSON passed unexpectedly"

# 3) optional domain allow
with_domain='{"q":"event loop","ns":"rebecca/army/refs","slot":"staging","topK":3,"candidateK":100,"minSimilarity":0,"nsMode":"prefix","domainFilter":{"allow":["developer.mozilla.org"]}}'
resp_domain="$(curl -sS -X POST "$BASE/api/retrieve" -H 'content-type: application/json' -d "$with_domain")" || fail "domain POST failed"
echo "$resp_domain" | jq -e '.items != null' >/dev/null 2>&1 && pass "domain allow accepted" || fail "domain allow not accepted"
