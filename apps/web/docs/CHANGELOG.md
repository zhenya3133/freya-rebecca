## Финишная прямая Фрея–Ребекка 29.08.2025

### Новые API и сервисные ручки
- /api/profiles/get — загрузка и фильтрация профилей (
ame, kind, 	ag, q), кэширование Cache-Control.
- /api/admin/whoami — диагностика admin-ключа (query/header/bearer).
- /api/admin/echo — возврат входящих заголовков (отладка прокси/хедеров).
- /api/admin/logs/list — просмотр логов с фильтрами: 
s, limit, since (ISO), kind (нормализуются дефисы→точки), kindPrefix.

### Изменения в RAG (answer*)
- nswer / nswer-guarded / nswer-logged / nswer-logged-guarded:
  - Поддержка profileName (qa/list/json/code) — подтягивание параметров из seed-профилей.
  - Пост-обработка:
    - json: извлечение «чистого» JSON из markdown, безопасный парс, фолбэк [].
    - code: ровно один fenced-блок с указанным codeLang.
  - Единый формат ответа: nswer, sources, matches, profile, model, mode.

### Ingest / KB
- /api/ingest/seed:
  - Приём { ns, docs:[{title,content,path?,url?}], clear?, clearAll? }.
  - Поддержка YAML front-matter (gray-matter) → попадает в source.metadata.
  - Эмбеддинги 	ext-embedding-3-small, идемпотентность по content_hash (sha256 ns|title|source|content).
  - Регистрация корпуса в corpus_registry, вставка чанков (slot: staging).

### Admin / Security
- Единый middleware pps/web/src/middleware.ts для /api/admin/* (+ при необходимости /api/ingest/*).
  - Три способа ключа: ?adminKey=…, заголовок x-admin-key, Authorization: Bearer ….
  - Убраны дубликаты и конфликты middleware.

### База данных / Логи
- Таблица logs + индексы (created_at, kind), логирование ответов nswer*, просмотр через /api/admin/logs/list.

### Профили
- src/lib/profiles.ts: чтение seeds/profiles/*.json, фильтры 
ame/kind/tag/q, saveProfile, deleteProfile, slugifyName. Невалидные файлы (массив вместо объекта и т.п.) — пропускаются с варнингом.

### Health / Диагностика
- /api/health/env — безопасный срез переменных окружения (без секретов).
- /api/health/db — ping БД.

### Примечания
- kind в логах — точечная нотация (ag.answer.logged), дефисы в запросах нормализуются в точки.
- .env* и локальные конфиги игнорируются .gitignore.
