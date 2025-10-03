-- Использование:
--   psql "$DATABASE_URL" -v tbl='chunks' -f scripts/diag/list_columns.sql

SELECT
  c.table_schema AS schema,
  c.table_name   AS table,
  c.ordinal_position AS pos,
  c.column_name  AS column,
  c.data_type    AS type,
  c.is_nullable  AS nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name   = :'tbl'
ORDER BY c.ordinal_position;
