#!/usr/bin/env bash
set -euo pipefail

# Требования:
#  - GitHub CLI: gh auth login
#  - Находиться в корне нужного репозитория (или указать REPO_NWO)

REPO_NWO="${REPO_NWO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)}"
if [[ -z "$REPO_NWO" ]]; then
  echo "❌ Не удалось определить репозиторий. Либо запусти в git-репозитории с gh, либо экспортируй REPO_NWO=owner/repo"
  exit 1
fi
echo "📦 Репозиторий: $REPO_NWO"

# ---------- 1) ЛЕЙБЛЫ ----------
# name|color (hex без '#')|description
LABELS=(
  "db|0e8a16|Database & indexing"
  "architecture|5319e7|Architecture & design"
  "docs|0052CC|Documentation"
  "ingest|d73a4a|Ingest pipelines"
  "ci|fbca04|CI & testing"
  "quality|c2e0c6|Eval & quality"
  "rag|1d76db|RAG pipelines"
  "llm|c5def5|LLM provider layer"
  "mcp|006b75|MCP adapters"
  "frontend|d4c5f9|Freya Console UI"
  "a2a|b60205|Agent-to-Agent readiness"
  "ops|bfd4f2|Operations & security"
)

echo "🏷  Создаю/синхронизирую лейблы…"
for spec in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$spec"
  # Проверка существования
  if gh api "repos/${REPO_NWO}/labels/${name}" >/dev/null 2>&1; then
    # Обновим цвет/описание на всякий случай
    gh api -X PATCH "repos/${REPO_NWO}/labels/${name}" \
      -f new_name="$name" -f color="$color" -f description="$desc" >/dev/null
  else
    gh api -X POST "repos/${REPO_NWO}/labels" \
      -f name="$name" -f color="$color" -f description="$desc" >/dev/null
  fi
done
echo "✅ Лейблы готовы."

# ---------- 2) МАЙЛСТОУНЫ ----------
# title|description
MILES=(
  "A. Data Foundation|Хэши/UNIQUE, политика Hot/Warm/Cold, дедуп, Sizing & Tuning"
  "B. Ingest Front|YouTube Whisper fallback, /api/ingest/text, CI+smoke, eval+metrics"
  "C. Unfreeze RAG|/api/answer,/api/ask,/memory, hybrid+rerank, citations, guardrails"
  "D. MCP Layer|MCP-адаптеры для ingest/retrieve, авторизация, README"
  "E. Freya Console UI|Загрузка, Поиск, Чат, Админ-панель"
  "F. A2A Readiness|Роли, outbox/queue, capability cards"
  "G. Scale & Prod|Партиции, индексы, backfill/reindex, бэкапы, мониторинг, безопасность"
)

declare -A MNUM  # title -> number
echo "🎯 Создаю/синхронизирую майлстоуны…"
for m in "${MILES[@]}"; do
  title="${m%%|*}"
  desc="${m#*|}"
  # Попробуем найти существующий
  existing="$(gh api "repos/${REPO_NWO}/milestones?state=all&per_page=100" | jq -r --arg t "$title" '.[] | select(.title==$t) | @base64' || true)"
  if [[ -n "$existing" ]]; then
    obj="$(echo "$existing" | head -n1 | base64 -d)"
    num="$(echo "$obj" | jq -r '.number')"
    # Обновим описание и откроем (на случай, если закрыт)
    gh api -X PATCH "repos/${REPO_NWO}/milestones/${num}" \
      -f title="$title" -f description="$desc" -f state="open" >/dev/null
    MNUM["$title"]="$num"
  else
    # Создаём
    created="$(gh api -X POST "repos/${REPO_NWO}/milestones" -f title="$title" -f state="open" -f description="$desc")"
    num="$(echo "$created" | jq -r '.number')"
    MNUM["$title"]="$num"
  fi
done
echo "✅ Майлстоуны готовы."

# ---------- 3) УТИЛИТА СОЗДАНИЯ ISSUE ----------
create_issue () {
  local title="$1"
  local body="$2"
  local milestone_title="$3"
  local labels_csv="$4"

  local milestone_num="${MNUM[$milestone_title]:-}"
  if [[ -z "$milestone_num" ]]; then
    echo "⚠️  Не найден номер майлстоуна '$milestone_title' — пропущено: $title"
    return 0
  fi

  gh issue create \
    --title "$title" \
    --body "$body" \
    --milestone "$milestone_title" \
    --label "$labels_csv" >/dev/null

  echo "  • Issue: $title  [${milestone_title}]  {$labels_csv}"
}

echo "📝 Создаю задачи…"

# A
create_issue "UNIQUE(ns,slot,source_id,chunk_no) + content_hash" \
"- [ ] Добавить content_hash с нормализацией текста
- [ ] UNIQUE(ns,slot,source_id,chunk_no) + индекс по hash
- [ ] Идемпотентный upsert в upsertChunksWithTargets" \
"A. Data Foundation" "db"

create_issue "Политика Hot/Warm/Cold + партиционирование (ns/slot × time)" \
"- [ ] Документ policy (месяц/квартал)
- [ ] План партиционирования (doc-first)
- [ ] Критерии миграции в warm/cold" \
"A. Data Foundation" "architecture"

create_issue "Sizing & Tuning guide" \
"- [ ] Формулы объёмов (вектор/индекс)
- [ ] Рекомендации HNSW/IVFFLAT
- [ ] VACUUM/REINDEX расписания" \
"A. Data Foundation" "docs"

# B
create_issue "YouTube: Whisper fallback" \
"- [ ] /api/ingest/youtube — если нет сабов, транскрибируем
- [ ] Параметры lang/timestamps; chunking как у PDF
- [ ] Лимиты и прогресс-лог" \
"B. Ingest Front" "ingest"

create_issue "Универсальный текстовый ingest /api/ingest/text" \
"- [ ] POST raw text + meta (ns/slot/kind/url)
- [ ] chunkText + upsert + embeddings
- [ ] CLI scripts/ingest_text.sh" \
"B. Ingest Front" "ingest"

create_issue "CI + smoke-тесты ingest→retrieve" \
"- [ ] tsc, линтер, e2e ingest маленького текста
- [ ] Проверка retrieve по ключевым словам" \
"B. Ingest Front" "ci"

create_issue "Metrics & Evals (baseline)" \
"- [ ] 5–10 golden-вопросов
- [ ] nightly eval; алерты на регресс" \
"B. Ingest Front" "quality"

# C
create_issue "/api/answer: RAG с цитатами" \
"- [ ] Вектор+BM25 ретрив, top-50 → rerank
- [ ] Обязательные ссылки на источники (URL/файл/репо)
- [ ] Guardrails (timeouts, retries, no-citation=no-answer)" \
"C. Unfreeze RAG" "rag"

create_issue "/api/ask: multi-turn + память" \
"- [ ] Thread storage (short/long)
- [ ] Inline цитаты + кнопки «показать источники»" \
"C. Unfreeze RAG" "rag"

create_issue "LLM provider layer (Option C) — интеграция в RAG" \
"- [ ] Подключить lib/llm/* в /api/answer,/api/ask
- [ ] Переключение через .env (openai/openrouter)" \
"C. Unfreeze RAG" "llm"

# D
create_issue "MCP адаптеры: ingest tools (GitHub/URL/PDF/YouTube/Text)" \
"- [ ] MCP endpoints для наших роутов
- [ ] Авторизация и квоты
- [ ] README с примерами вызова" \
"D. MCP Layer" "mcp"

create_issue "MCP: retrieve/search capability" \
"- [ ] Поиск с фильтрами (ns/slot/date)
- [ ] Унифицированный формат результатов" \
"D. MCP Layer" "mcp"

# E
create_issue "UI: Загрузка (URL/PDF/GitHub/YouTube/Text)" \
"- [ ] Формы, опции chunk/dryRun/skipEmb
- [ ] Прогресс/лог последней операции" \
"E. Freya Console UI" "frontend"

create_issue "UI: Поиск" \
"- [ ] Query + фильтры (ns/slot/domain/date)
- [ ] Список чанков с переходом к источнику" \
"E. Freya Console UI" "frontend"

create_issue "UI: Чат (RAG)" \
"- [ ] Multi-turn; выбор модели (если openrouter)
- [ ] Цитаты и кнопка «источники»" \
"E. Freya Console UI" "frontend"

create_issue "UI: Admin" \
"- [ ] Диагностика (db-ping, gh-rate)
- [ ] Размеры таблиц/индексов; NULL-эмбеддинги; backfill/reindex" \
"E. Freya Console UI" "frontend"

# F
create_issue "A2A: роли и capability-карты" \
"- [ ] Planner/Retriever/Coder/Runner
- [ ] IO-границы, capability cards" \
"F. A2A Readiness" "a2a"

create_issue "A2A: outbox/queue для делегирования" \
"- [ ] Схема очереди (outbox)
- [ ] Трейсинг задач" \
"F. A2A Readiness" "a2a"

# G
create_issue "Партиционирование и индексы (HNSW/IVFFLAT)" \
"- [ ] Включение партиций по порогу объёма
- [ ] Стратегия hot/warm/cold" \
"G. Scale & Prod" "db"

create_issue "Backfill/Reindex schedule + Backups/Restore" \
"- [ ] Ночные джобы
- [ ] Бэкапы и проверка восстановления" \
"G. Scale & Prod" "ops"

create_issue "Мониторинг и безопасность" \
"- [ ] Метрики latency/size/cache
- [ ] Rate-limits, audit, rotate ключей" \
"G. Scale & Prod" "ops"

echo "✅ Roadmap bootstrap complete."
