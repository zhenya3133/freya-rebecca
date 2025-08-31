## Финишная прямая Фрея–Ребекка 29.08.2025

### Коротко что добавлено
- Профили ответов и API /api/profiles/get (фильтры: name/kind/tag/q).
- RAG nswer* с profileName (qa/list/json/code), пост-обработка JSON/Code, единый формат ответов.
- Ingest /api/ingest/seed с YAML front-matter, идемпотентные хэши, регистрация корпуса.
- Admin-мидлвар и ручки /api/admin/whoami, /api/admin/echo, /api/admin/logs/list.
- Таблица logs + индексы, логирование answer* и просмотр логов.
- Health /api/health/env, /api/health/db.
- Либа lib/profiles.ts (+save/delete), пропуск невалидных сидов.
