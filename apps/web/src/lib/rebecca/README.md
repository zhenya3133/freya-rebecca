# Rebecca AI Agent

AI Agent с архитектурой трёх видов памяти, системой планирования и возможностью использования инструментов.

## 🧠 Архитектура

### Три вида памяти

1. **Working Memory (Рабочая память)** - в RAM
   - Живёт только во время выполнения задачи
   - Содержит: цель, план, текущий шаг, scratchpad, результаты инструментов

2. **Episodic Memory (Эпизодическая память)** - в БД
   - Что произошло, когда и как
   - События: task_completed, task_failed, tool_used, user_interaction
   - Поиск: семантический (по embedding) + временной

3. **Semantic Memory (Семантическая память)** - в БД
   - Долгосрочные знания: факты, навыки, паттерны, guidelines
   - Поиск: семантический (по embedding)
   - Обновление: confidence score, uses_count

### Компоненты

- **MemoryManager**: управление тремя видами памяти
- **Planner**: декомпозиция целей на последовательность шагов
- **PlanExecutor**: выполнение плана с проверкой зависимостей
- **ToolRegistry**: реестр доступных инструментов
- **LLMProvider**: универсальный интерфейс для LLM (OpenAI, OpenRouter, local)

## 🚀 Использование

### Quick Start

```typescript
import { RebeccaAgent } from "@/lib/rebecca";

const agent = new RebeccaAgent("my-namespace");

const result = await agent.execute("Find information about AI agents", {
  context_key: "some_value",
});

console.log(result.final_output);
console.log(result.steps_completed);
```

### API Endpoint

```bash
POST /api/rebecca/v2

{
  "goal": "Your goal here",
  "namespace": "optional-namespace",
  "context": {}
}
```

### Configuration

Переменные окружения:

```bash
# База данных
DATABASE_URL=postgresql://...

# LLM Provider (по умолчанию OpenAI)
REBECCA_PROVIDER=openai  # openai | openrouter | local
REBECCA_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...

# OpenRouter (опционально)
OPENROUTER_API_KEY=sk-or-...

# Local models (опционально)
REBECCA_BASE_URL=http://localhost:1234/v1

# Embeddings
EMBED_MODEL=text-embedding-3-small
EMBED_DIMS=1536
```

## 🛠 Инструменты

### Memory Tools

- `search_semantic_memory`: поиск знаний
- `search_episodic_memory`: поиск прошлых событий
- `save_knowledge`: сохранение нового знания
- `get_recent_episodes`: получение последних эпизодов
- `get_knowledge_by_kind`: получение знаний по типу

### File Loader Tools

- `load_file`: загрузка PDF/DOCX с чанкованием
- `load_github_repo`: клонирование и индексация GitHub репозитория

### Web Search (заглушка)

- `web_search`: поиск в интернете (TODO: интеграция с Tavily/Serper/Brave)

## 📦 Установка БД

```bash
# Применить миграцию
node scripts/migrate-rebecca-memory.js
```

Создаст 5 таблиц:
- `episodic_memory` - эпизодическая память
- `semantic_memory` - семантическая память
- `tool_executions` - история вызовов инструментов
- `reflections` - рефлексия после выполнения задач
- `agent_sessions` - сессии выполнения агента

## 🔧 Добавление новых инструментов

```typescript
import { globalToolRegistry } from "@/lib/rebecca/tools/registry";
import type { Tool } from "@/lib/rebecca/types";

const myTool: Tool = {
  name: "my_custom_tool",
  description: "What this tool does",
  parameters: [
    {
      name: "param1",
      type: "string",
      description: "Parameter description",
      required: true,
    },
  ],
  returns: "What this tool returns",
};

async function myToolHandler(params: Record<string, any>) {
  // Implement tool logic here
  return { result: "success" };
}

globalToolRegistry.register(myTool, myToolHandler);
```

## 📊 Структура ответа

```typescript
interface ExecutionResult {
  success: boolean;
  goal: string;
  plan: Plan;
  steps_completed: PlanStep[];
  final_output: any;
  reflections: Reflection;
  working_memory_snapshot: WorkingMemory;
  duration_ms: number;
  tokens_used?: number;
  error?: string;
}
```

## 🎯 Примеры использования

### Простая задача

```typescript
const result = await agent.execute("What is 2+2?");
// Автоматически определит, что планирование не нужно
// Выполнит напрямую через LLM
```

### Сложная задача с планированием

```typescript
const result = await agent.execute(
  "Research competitors in AI agents space and create a summary report"
);
// 1. Создаст план действий
// 2. Выполнит шаг за шагом
// 3. Сохранит результаты в память
// 4. Вернёт финальный отчёт
```

### Загрузка документов

```typescript
// Через API tool call в плане
const result = await agent.execute(
  "Load documentation from GitHub repo https://github.com/example/docs and answer questions about it"
);
```

## 🔍 Поиск в памяти

```typescript
import { MemoryManager } from "@/lib/rebecca";

const memory = new MemoryManager("my-namespace");

// Поиск знаний
const knowledge = await memory.searchKnowledge("AI agents", 5, 0.5);

// Поиск эпизодов
const episodes = await memory.searchEpisodes("failed API calls", 3);

// Сохранение знания
const id = await memory.saveKnowledge({
  kind: "pattern",
  content: "Always validate user input",
  confidence: 0.9,
  source: "learned",
});
```

## 🐛 Troubleshooting

### LLM провайдер не отвечает

Проверьте:
1. Правильность API ключа
2. Доступность сервиса
3. Логи в консоли: `[Rebecca] LLM Provider: {...}`

### Ошибки с embeddings

Проверьте:
1. `OPENAI_API_KEY` установлен
2. `EMBED_DIMS=1536` соответствует модели
3. В БД создано расширение `pgvector`

### База данных не найдена

Проверьте:
1. `DATABASE_URL` правильный
2. Миграция применена: `node scripts/migrate-rebecca-memory.js`
3. Таблицы созданы: проверьте через psql

## 📝 TODO для будущих версий

- [ ] Reflection & Learning: автоматическое обновление semantic memory
- [ ] Web Search: интеграция с реальным API (Tavily/Serper)
- [ ] Streaming: поддержка потокового ответа от LLM
- [ ] Multi-agent: координация между несколькими агентами
- [ ] Memory cleanup: автоматическая очистка старых данных
- [ ] Analytics: dashboard для просмотра статистики
- [ ] Rate limiting: защита от перегрузки
- [ ] Caching: кеширование LLM ответов

## 📄 Лицензия

См. корневой LICENSE файл проекта.
