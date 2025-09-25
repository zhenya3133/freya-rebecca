-- Индексы и инварианты (идемпотентно)
CREATE INDEX IF NOT EXISTS chunks_ns_slot_idx
  ON public.chunks(ns, slot);

CREATE INDEX IF NOT EXISTS chunks_ns_slot_published_idx
  ON public.chunks(ns, slot, published_at DESC);

CREATE INDEX IF NOT EXISTS chunks_metadata_gin_idx
  ON public.chunks USING gin(metadata);

-- ANN индекс по эмбеддингам
CREATE INDEX IF NOT EXISTS chunks_embedding_ivfflat_idx
  ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Ключ идемпотентности ingest
CREATE UNIQUE INDEX IF NOT EXISTS chunks_unique_source_idx
  ON public.chunks(ns, slot, COALESCE(source_id, ''), chunk_no);
