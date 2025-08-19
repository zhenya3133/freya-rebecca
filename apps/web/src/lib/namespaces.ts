// apps/web/src/lib/namespaces.ts

export type NamespaceDef = {
  key: string;            // машинное имя ns (латиница/дефисы)
  title: string;          // человекочитаемое имя
  description: string;    // краткое описание, для класификации/поиска
  examples?: string[];    // подсказки-контексты
  aliases?: string[];     // синонимы для матчинга
};

export const NAMESPACES: NamespaceDef[] = [
  {
    key: "rebecca-core",
    title: "Rebecca Core",
    description:
      "Ядро: принципы архитектуры ИИ-агентов, ваши стандарты, ADR/PRD, чек-листы, код-стайл.",
    examples: ["архитектурные решения команды", "шаблоны планов, ADR", "внутренние best practices"],
    aliases: ["core", "standards", "adr", "playbook-core"],
  },
  {
    key: "agents-patterns",
    title: "Agent Patterns",
    description:
      "Паттерны многоагентных систем: planner/executor, ReAct, Reflexion, swarms, tool-use.",
    examples: ["React", "Reflexion", "planner-executor", "multi-agent coordination"],
    aliases: ["patterns", "multi-agent", "swarm"],
  },
  {
    key: "rag-patterns",
    title: "RAG Patterns",
    description:
      "RAG: индексация, чанкеры, перезапросы, гибридный поиск, фильтры, reranking, цитирование.",
    examples: ["pgvector", "rerank", "hybrid search", "citation", "chunking"],
    aliases: ["rag", "retrieval augmentation"],
  },
  {
    key: "memory-systems",
    title: "Memory Systems",
    description:
      "Долговременная память: семантическая, эпизодическая, профиль пользователя, векторные БД.",
    examples: ["episodic", "profile store", "vector db"],
  },
  {
    key: "agents-sdks",
    title: "Agent SDKs",
    description:
      "SDK/фреймворки агентов: LangGraph, CrewAI, AutoGen, CAMEL, Smolagents, Agno и др.",
    examples: ["LangGraph", "CrewAI", "AutoGen", "CAMEL", "Agno", "Smolagents"],
    aliases: ["frameworks", "sdk"],
  },
  {
    key: "tools-integrations",
    title: "Tools & Integrations",
    description:
      "Инструменты/интеграции: браузеринг, SERP, календарь/CRM/Slack/Telegram, парсеры.",
    examples: ["calendar", "CRM", "Notion", "Slack", "Telegram", "web scraper"],
  },
  {
    key: "eval-and-test",
    title: "Evaluation & Testing",
    description:
      "Оценка: Ragas, DeepEval, Evals, golden-sets, регрессионные тесты агентов/RAG.",
    examples: ["Ragas", "DeepEval", "CI quality", "golden dataset"],
  },
  {
    key: "infra-serving",
    title: "Infra & Serving",
    description:
      "Сервинг/деплой: vLLM/TGI, Next.js API, Docker/K8s, очереди, observability.",
    examples: ["vLLM", "TGI", "Next.js", "Docker", "Kubernetes", "Grafana"],
  },
  {
    key: "security-compliance",
    title: "Security & Compliance",
    description:
      "Безопасность: guardrails, PII-редакция, RBAC/ABAC, аудит, лицензии, политики.",
    examples: ["PII", "RBAC", "license", "audit", "policy"],
  },
  {
    key: "cost-optim",
    title: "Cost Optimization",
    description:
      "Оптимизация стоимости: токены, сжатие контекста, кэш, роутеры моделей, квоты.",
    examples: ["token cost", "router", "compression", "cache"],
  },
  {
    key: "vendor-openai",
    title: "Vendor: OpenAI",
    description:
      "Материалы по OpenAI: модели, лимиты, примеры API, best practices.",
    examples: ["gpt-4.1", "text-embedding-3-small", "API examples"],
    aliases: ["openai"],
  },
  {
    key: "vertical-beauty",
    title: "Vertical: Beauty",
    description:
      "Домен: салон красоты/мастер маникюра. Процессы, CRM, tone-of-voice, KPI.",
    examples: ["nail salon", "appointment", "beauty CRM", "reminders"],
    aliases: ["beauty", "nails", "salon"],
  },
  {
    key: "rebecca-playbooks",
    title: "Rebecca Playbooks",
    description:
      "Плейбуки/шаблоны процессов: discovery → design → build → eval → deploy → handoff.",
    examples: ["checklist", "template", "process playbook"],
    aliases: ["playbooks"],
  },
  {
    key: "sandbox",
    title: "Sandbox",
    description:
      "Временная полка для черновых импортов, всё, что классификатор не понял с нужной уверенностью.",
    examples: ["drafts", "misc", "unknown"],
    aliases: ["tmp", "drafts"],
  },
];

// Утилита: разрешён ли ns (если передан allowList)
export function filterAllowed(keys: string[] | undefined, ns: NamespaceDef[]): NamespaceDef[] {
  if (!keys || keys.length === 0) return ns;
  const set = new Set(keys.map(k => k.trim().toLowerCase()));
  return ns.filter(n => set.has(n.key));
}
