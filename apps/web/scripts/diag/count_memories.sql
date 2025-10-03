\pset pager off
SELECT
  ns,
  COALESCE(slot,'staging') AS slot,
  COUNT(*) AS cnt
FROM memories
GROUP BY ns, COALESCE(slot,'staging')
ORDER BY cnt DESC, ns, slot
LIMIT 200;
