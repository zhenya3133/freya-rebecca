-- Бэκфилл chunks из memories по rebecca/army/refs*, без дублей по id

-- 1) Индекс по ns (ускорит фильтрацию/вставку)
CREATE INDEX IF NOT EXISTS idx_memories_ns ON public.memories(ns);

-- 2) Вставляем недостающие записи
INSERT INTO public.chunks (id, kind, ns, slot, content, embedding, metadata, created_at)
SELECT m.id, m.kind, m.ns, m.slot, m.content, m.embedding, m.metadata, m.created_at
FROM public.memories m
LEFT JOIN public.chunks c ON c.id = m.id
WHERE m.ns LIKE 'rebecca/army/refs%'
  AND c.id IS NULL;

-- 3) Индексы на chunks
CREATE INDEX IF NOT EXISTS idx_chunks_ns ON public.chunks(ns);

-- Если у тебя pgvector установлен и тип embedding = vector(...), раскомментируй строку ниже.
-- Подбери операторный класс под твою метрику: vector_cosine_ops / vector_l2_ops / vector_ip_ops
-- CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON public.chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
