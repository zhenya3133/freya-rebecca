\pset pager off
SELECT ns, slot, COUNT(*) AS cnt
FROM chunks
GROUP BY ns, slot
ORDER BY cnt DESC, ns, slot
LIMIT 200;
