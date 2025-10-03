-- apps/web/scripts/diag/count_ns.sql
\pset pager off

-- if :ns не передан, используем пустую строку (значит "все ns")
\if :{?ns}
\else
\set ns ''
\endif

-- добавим % в конец для префикс-поиска
\set ns_pat :ns '%'

-- 1) разрез по ns
SELECT
  ns,
  COUNT(*)                                                     AS total,
  COUNT(*) FILTER (WHERE slot='staging')                      AS staging,
  COUNT(*) FILTER (WHERE slot='prod')                         AS prod,
  COUNT(*) FILTER (WHERE url ILIKE '%developer.mozilla.org%') AS mdn,
  COUNT(*) FILTER (WHERE url ILIKE '%arxiv.org%')             AS arxiv
FROM chunks
WHERE (:'ns' = '' OR ns LIKE :'ns_pat')
GROUP BY ns
ORDER BY ns;

-- 2) общий итог
SELECT
  COUNT(*)                                                     AS total,
  COUNT(*) FILTER (WHERE slot='staging')                      AS staging,
  COUNT(*) FILTER (WHERE slot='prod')                         AS prod,
  COUNT(*) FILTER (WHERE url ILIKE '%developer.mozilla.org%') AS mdn,
  COUNT(*) FILTER (WHERE url ILIKE '%arxiv.org%')             AS arxiv
FROM chunks
WHERE (:'ns' = '' OR ns LIKE :'ns_pat');
