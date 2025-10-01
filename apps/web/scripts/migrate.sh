#!/usr/bin/env bash
set -euo pipefail

# Абсолютные пути к scripts/ и scripts/migrations/
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
MIG_DIR="${SCRIPTS_DIR}/migrations"

# Проверим переменные и psql
: "${DATABASE_URL:?DATABASE_URL is not set (export it or source apps/web/.env.local)}"
command -v psql >/dev/null || { echo "psql not found"; exit 1; }

echo "== running migrations from: ${MIG_DIR}"

# Базовые расширения (идемпотентно)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# Прогоним все G*.sql по алфавиту (G0_init.sql, G5_*.sql, и т.д.)
shopt -s nullglob
for f in "${MIG_DIR}"/G*.sql; do
  echo "-- psql -f $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -f "$f"
done
shopt -u nullglob

# (опционально) поставить дефолт для ivfflat.probes
if [[ -n "${RETRIEVE_PROBES:-}" ]]; then
  DBNAME="$(psql "$DATABASE_URL" -Atc 'select current_database()')"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
    "ALTER DATABASE \"${DBNAME}\" SET ivfflat.probes = ${RETRIEVE_PROBES};"
  echo "ivfflat.probes default -> ${RETRIEVE_PROBES}"
fi

echo "Migrations OK."
