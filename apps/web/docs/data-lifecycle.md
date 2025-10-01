# Data Lifecycle (RC-v1)

## 1) Идентичность чанка
- **Unique key**: `(ns, slot, source_id, chunk_no)`.
- **content_hash**: `sha256(ns|slot|source_id|chunk_no|content)`, NOT NULL.
- Повторный ingest с теми же `(ns,slot,source_id,chunk_no,content)` → *idempotent update* без изменений.

## 2) Вставка/обновление
- Вставка: `INSERT ... ON CONFLICT (ns,slot,source_id,chunk_no) DO UPDATE`.
- При конфликте: обновляем `content`, `title`, `url`, `content_hash`; `embedding` меняем только если прислали новую (`COALESCE(EXCLUDED.embedding, chunks.embedding)`).
- Таймштампы: `created_at` однажды; `updated_at = NOW()` при любом апдейте.

## 3) Повторный разбор источника (re-ingest)
- Если контент изменился → изменится `content_hash` → апдейт строки и, при необходимости, **invalidate embeddings** (см. Backfill).
- Если сегментация изменилась (другой `chunk_no`) — это **новые строки**; старые помечать к удалению отдельной процедурой (см. §6).

## 4) Embeddings
- Допускаются `NULL` на ingest (фоновая заливка).
- Backfill-скрипт читает чанки с `embedding IS NULL` **или** с флагом «устаревших» эмбеддингов (см. §5).

## 5) Полу-жизнь и TTL (recency)
- Для каждого `ns` задаём `half_life_days` и `ttl_days` в таблице-паспортов (пока — конфиг в коде).
- Итоговый скор: `final = α·similarity + β·time_decay(age)`.
- При `age > ttl_days` — фильтровать из выдачи (или снижать вес до нуля).

## 6) Удаления и «осиротевшие» чанки
- При полном re-ingest источника сохраняем список `(source_id, chunk_no)` актуальной схемы.
- Всё, что не входит в актуальный список, маркируем `to_delete=true` и удаляем «мягко» (архивная таблица) либо жёстко — регламентом задачи.

## 7) Горячие/тёплые/холодные данные
- **Hot**: последние `N` дней и `ns` с высокой частотой запросов — держим индексы плотными, backfill embeddings по приоритету.
- **Warm**: старше `N` и до `ttl_days` — обычный приоритет.
- **Cold**: старше `ttl_days` — кандидаты на архив/удаление.

## 8) Идемпотентность / дедуп
- Unique key + content_hash исключают дубли на уровне БД и кода.
- Любой ingest опирается на `unchanged detection`: если `content_hash` совпал — не трогать `embedding`.

## 9) Логи
- Для каждого admin-ingest писать: `{inserted, updated, unchanged, failures}` + лимиты и окно пагинации (для GitHub/YouTube).
