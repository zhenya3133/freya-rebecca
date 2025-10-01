#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL first}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
SELECT
  schemaname AS schema,
  tablename  AS table,
  tableowner AS owner
FROM pg_tables
WHERE schemaname='public'
ORDER BY tablename;
SQL
