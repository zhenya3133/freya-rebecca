-- Показать таблицы в public
SELECT
  schemaname  AS schema,
  tablename   AS table,
  tableowner  AS owner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY 1,2;
