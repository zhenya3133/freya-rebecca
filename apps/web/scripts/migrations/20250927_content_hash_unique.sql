-- 20250927_content_hash_unique.sql

-- 0) расширение для digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) столбец content_hash (врем. NULL → затем backfill → NOT NULL)
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS content_hash text;

-- 2) backfill: детерминированный хеш по идентичности чанка + контенту
--    sha256(ns|slot|source_id|chunk_no|content)
UPDATE chunks
SET content_hash = encode(digest(
  coalesce(ns,'') || '|' ||
  coalesce(slot,'') || '|' ||
  coalesce(source_id,'') || '|' ||
  chunk_no::text || '|' ||
  coalesce(content,'')
, 'sha256'), 'hex')
WHERE content_hash IS NULL;

-- 3) запрет NULL после backfill
ALTER TABLE chunks
  ALTER COLUMN content_hash SET NOT NULL;

-- 4) строгая уникальность идентичности чанка
CREATE UNIQUE INDEX IF NOT EXISTS chunks_unique_identity_idx
  ON chunks (ns, slot, source_id, chunk_no);

-- 5) полезные индексы
CREATE INDEX IF NOT EXISTS chunks_ns_slot_created_at_idx
  ON chunks (ns, slot, created_at DESC);
