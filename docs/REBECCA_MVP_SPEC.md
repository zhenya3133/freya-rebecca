# Rebecca MVP - Спецификация и согласование деталей

## 📋 Проверка перед началом работы

### ✅ Текущее состояние проекта

**Структура:**
```
apps/web/src/lib/
├── db.ts                  ✅ Есть (Pool подключение к PostgreSQL)
├── embeddings.ts          ✅ Есть (OpenAI embeddings, text-embedding-3-small, 1536 dims)
├── schemas/
│   └── agent.ts          ✅ Есть
└── rebecca/              
    ├── types.ts          ✅ Создан (интерфейсы памяти, плана, инструментов)
    └── schema.sql        ✅ Создан (SQL для 5 таблиц)
```

**Переменные окружения (.env):**
```
DATABASE_URL=postgresql://...          # PostgreSQL с pgvector
OPENAI_API_KEY=sk-...                 # OpenAI API (есть у пользователя)
OPENROUTER_API_KEY=...                # Добавим поддержку (опционально)
REBECCA_MODEL=gpt-4-mini              # По умолчанию
EMBED_MODEL=text-embedding-3-small    # Для embeddings
EMBED_DIMS=1536                       # Размерность векторов
```

---

## 🎯 MVP Scope - Что делаем

### Фаза 1: Memory System

**Файлы:**
- `apps/web/src/lib/rebecca/memory-manager.ts` - класс управления тремя видами памяти
- `scripts/migrate-rebecca-memory.js` - скрипт применения SQL миграции

**Три вида памяти:**

1. **Working Memory** (рабочая, в RAM)
   - Хранится только во время выполнения задачи
   - Содержит: цель, план, текущий шаг, scratchpad, результаты инструментов
   - НЕ сохраняется в БД

2. **Episodic Memory** (эпизодическая, в БД)
   - Таблица: `episodic_memory`
   - Что хранит: события (task_completed, task_failed, tool_used и т.д.)
   - Поиск: по embedding (семантический) + по времени

3. **Semantic Memory** (семантическая, в БД)
   - Таблица: `semantic_memory`
   - Что хранит: факты, знания, паттерны, навыки
   - Поиск: по embedding
   - Обновление: confidence score, uses_count

**Дополнительные таблицы:**
- `tool_executions` - история вызовов инструментов
- `reflections` - рефлексия после задач
- `agent_sessions` - сессии выполнения агента

---

### Фаза 2: Planning System

**Файлы:**
- `apps/web/src/lib/rebecca/planner.ts` - генерация плана
- `apps/web/src/lib/rebecca/executor.ts` - выполнение плана

**Как работает:**
1. Пользователь даёт цель (goal)
2. Planner декомпозирует цель на шаги (steps)
3. Каждый шаг может иметь зависимости от других шагов
4. Executor выполняет шаги по порядку
5. Если шаг провалился → перепланирование или пропуск

**План (структура):**
```typescript
{
  goal: "Найти информацию о конкурентах",
  steps: [
    {
      id: "step-1",
      description: "Поиск в semantic memory",
      dependencies: [],
      tool: "search-memory",
      status: "pending"
    },
    {
      id: "step-2",
      description: "Веб-поиск если нужно",
      dependencies: ["step-1"],
      tool: "web-search",
      status: "pending"
    }
  ],
  estimated_complexity: "moderate",
  confidence: 0.85
}
```

---

### Фаза 5: Agent Core

**Файлы:**
- `apps/web/src/lib/rebecca/agent.ts` - главный класс `RebeccaAgent`
- `apps/web/src/app/api/rebecca/v2/route.ts` - новый API endpoint

**Основной цикл агента:**
```
1. Initialize (создать working memory, загрузить контекст)
2. Plan (сгенерировать план)
3. Execute (выполнить план шаг за шагом)
4. Reflect (проанализировать результаты) - ПОКА ЗАГЛУШКА
5. Learn (обновить знания) - ПОКА ЗАГЛУШКА
6. Return result
```

**API Endpoint:**
```
POST /api/rebecca/v2
Body: {
  goal: string,
  namespace?: string,
  context?: Record<string, any>
}

Response: {
  success: boolean,
  session_id: string,
  plan: Plan,
  steps_completed: PlanStep[],
  final_output: any,
  duration_ms: number,
  tokens_used: number
}
```

---

## 🛠 Инструменты для MVP

### 1. Работа с памятью

**Файл:** `apps/web/src/lib/rebecca/tools/memory-tools.ts`

**Инструменты:**
- `search_semantic_memory` - поиск знаний
- `search_episodic_memory` - поиск прошлых событий
- `save_knowledge` - сохранить новое знание
- `update_knowledge_confidence` - обновить уверенность в знании

### 2. Веб-поиск

**Файл:** `apps/web/src/lib/rebecca/tools/web-search.ts`

**MVP версия:**
- Пока заглушка с TODO
- В будущем: интеграция с Tavily / Serper / Brave Search API
- Возвращает: массив результатов {title, url, snippet}

### 3. Работа с файлами

**Файл:** `apps/web/src/lib/rebecca/tools/file-loader.ts`

**Поддерживаемые форматы:**
- **GitHub репозитории** - клонирование и индексация
- **PDF** - извлечение текста (используем существующий `pdf-parse`)
- **DOC/DOCX** - извлечение текста (добавим библиотеку `mammoth`)

**Workflow:**
1. Пользователь загружает ссылку/файл через чат
2. Агент вызывает `load_file` или `load_github_repo`
3. Текст извлекается и чанкается
4. Чанки сохраняются в semantic_memory с embedding
5. Агент может потом искать по этим данным

---

## 🤖 LLM Provider (поддержка нескольких моделей)

**Файл:** `apps/web/src/lib/rebecca/llm-provider.ts`

**Поддерживаемые провайдеры:**

### 1. OpenAI (по умолчанию)
```typescript
OPENAI_API_KEY=sk-...
REBECCA_MODEL=gpt-4o-mini  // или gpt-4, gpt-4o
```

### 2. OpenRouter
```typescript
OPENROUTER_API_KEY=sk-or-...
REBECCA_PROVIDER=openrouter
REBECCA_MODEL=anthropic/claude-3.5-sonnet  // или другие модели
```

### 3. Локальные модели (через OpenAI-compatible API)
```typescript
REBECCA_PROVIDER=local
REBECCA_BASE_URL=http://localhost:1234/v1  // LM Studio, Ollama с OpenAI API
REBECCA_MODEL=qwen2.5:14b
```

**Структура:**
```typescript
class LLMProvider {
  static async chat(messages: Message[], options?: Options): Promise<Response>
  
  // Автоматический выбор провайдера на основе env vars
  // Единый интерфейс для всех провайдеров
}
```

---

## 📦 Новые зависимости для установки

```json
{
  "mammoth": "^1.6.0",      // Для DOCX
  "simple-git": "^3.22.0"   // Для клонирования GitHub repos (опционально)
}
```

**Команда:**
```bash
npm install mammoth simple-git
```

---

## 🗂 Структура файлов после MVP

```
apps/web/src/lib/rebecca/
├── types.ts                    ✅ Есть
├── schema.sql                  ✅ Есть
├── memory-manager.ts           📝 Создать (Фаза 1.1)
├── llm-provider.ts             📝 Создать (перед Фазой 2)
├── planner.ts                  📝 Создать (Фаза 2.1)
├── executor.ts                 📝 Создать (Фаза 2.2)
├── agent.ts                    📝 Создать (Фаза 5.1)
├── tools/
│   ├── registry.ts             📝 Создать
│   ├── memory-tools.ts         📝 Создать
│   ├── web-search.ts           📝 Создать (заглушка)
│   └── file-loader.ts          📝 Создать

apps/web/src/app/api/rebecca/
├── execute/route.ts            ✅ Старый endpoint (RAG)
└── v2/route.ts                 📝 Создать (Фаза 5.2)

scripts/
└── migrate-rebecca-memory.js   📝 Создать (Фаза 1.2)
```

---

## ⚙️ Порядок работы с коммитами

**После каждого шага:**
```bash
git add .
git commit -m "feat(rebecca): [описание шага]"
git push origin feature/rebecca-three-memory-types
```

**Пример коммитов:**
```
feat(rebecca): add memory manager with three memory types
feat(rebecca): add database migration script for memory tables
feat(rebecca): add LLM provider with OpenAI/OpenRouter/local support
feat(rebecca): add planner for goal decomposition
feat(rebecca): add plan executor with error handling
feat(rebecca): add tool registry and memory tools
feat(rebecca): add file loader for GitHub/PDF/DOCX
feat(rebecca): add main Rebecca agent with execution loop
feat(rebecca): add v2 API endpoint with full functionality
```

---

## ✅ Проверочный список перед стартом

- [x] Проверена структура БД (pool, embeddings работают)
- [x] Проверены переменные окружения
- [x] Согласован scope MVP (Фаза 1, 2, 5)
- [x] Согласованы инструменты (memory, web-search, file-loader)
- [x] Согласована поддержка LLM (OpenAI + OpenRouter + local)
- [x] Согласован формат работы (за один сеанс с коммитами)
- [ ] Установить новые зависимости (`mammoth`, `simple-git`)
- [ ] Применить SQL миграцию
- [ ] Создать все файлы по порядку

---

## 🚀 Готов к старту!

**Подтверждение пользователя:**
- ✅ Все детали согласованы
- ✅ Можно начинать работу

**Время оценки:** 6-8 часов чистой работы

**Результат:** Полностью рабочий Rebecca Agent с тремя видами памяти, планированием и базовыми инструментами.
