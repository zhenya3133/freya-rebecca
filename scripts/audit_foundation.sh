#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "== GIT ================================================================="
git status --porcelain=v1
echo
git branch --show-current
echo
git log --oneline -n 8
echo

echo "== TREE (apps/web) ====================================================="
if command -v tree >/dev/null 2>&1; then
  tree -a -L 4 apps/web | sed 's/\r//g'
else
  find apps/web -maxdepth 4 -print | sed 's/^\.\///'
fi
echo

echo "== GREP: ключевые файлы RC-v1 =========================================="
# Роуты инжеста/ретрива
grep -nH --color=never -E "export const runtime|export const dynamic|NextResponse" \
  apps/web/src/app/api/ingest/**/*.* \
  apps/web/src/app/api/retrieve/route.ts 2>/dev/null || true
echo

# Апсерт и хеш
grep -nH --color=never -E "upsertChunks|content_hash|digest|sha256" \
  apps/web/src/lib/**/*.* 2>/dev/null || true
echo

# Ретривер и контракт
grep -nH --color=never -E "retrieve|retriever|Retrieval|RC-?v1|domainFilter|recency" \
  apps/web/src/lib/**/*.* 2>/dev/null || true
echo

echo "== ENV (apps/web/.env.local: только ключевые) =========================="
grep -E '^(BASE|DATABASE_URL|X_ADMIN_KEY)=' apps/web/.env.local || true
echo

echo "== DB: схемы и индексы (через docker) =================================="
# Поменяй при необходимости имена контейнера/пользователя/БД
DB_CONT="${DB_CONT:-pgvector}"
DB_USER="${DB_USER:-rebecca}"
DB_NAME="${DB_NAME:-rebecca}"

docker exec -i "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -c "\dt"
echo
docker exec -i "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -c "\d+ chunks"
echo
docker exec -i "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -c "\di+ chunks_*"
echo
docker exec -i "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -c \
"SELECT count(*) AS chunks_total,
        sum((content_hash IS NOT NULL)::int) AS with_hash
 FROM chunks;"
echo

echo "== SAMPLE ROWS =========================================================="
docker exec -i "$DB_CONT" psql -U "$DB_USER" -d "$DB_NAME" -c \
"SELECT ns, slot, left(source_id,60) AS source, chunk_no,
        left(content_hash,12) AS hash12,
        to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at,
        to_char(updated_at,'YYYY-MM-DD HH24:MI') AS updated_at
 FROM chunks
 ORDER BY updated_at DESC NULLS LAST
 LIMIT 10;"
echo

echo "== DONE ================================================================"
