#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL first}"

TABLE="${1:-chunks}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off --quiet <<SQL
SELECT
  table_schema AS schema,
  table_name   AS table,
  ordinal_position AS pos,
  column_name AS column,
  data_type   AS type,
  is_nullable AS nullable,
  column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='${TABLE}'
ORDER BY ordinal_position;
SQL
