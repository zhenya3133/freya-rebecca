// apps/web/src/lib/rebecca/tools/memory-tools.ts
import { MemoryManager } from "../memory-manager";
import type { Tool } from "../types";
import { globalToolRegistry } from "./registry";

/**
 * Инструменты для работы с памятью Rebecca
 */

// ========== SEARCH SEMANTIC MEMORY ==========

export const searchSemanticMemoryTool: Tool = {
  name: "search_semantic_memory",
  description: "Search through semantic memory (long-term knowledge base) for relevant facts, skills, patterns, or guidelines",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query to find relevant knowledge",
      required: true,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum number of results to return",
      required: false,
      default: 5,
    },
    {
      name: "min_confidence",
      type: "number",
      description: "Minimum confidence score (0.0 to 1.0)",
      required: false,
      default: 0.3,
    },
  ],
  returns: "Array of knowledge items with content, kind, confidence, and usage stats",
  examples: [
    {
      input: { query: "How to handle API rate limits", limit: 3 },
      output: [
        {
          content: "Use exponential backoff when encountering rate limits",
          kind: "pattern",
          confidence: 0.85,
        },
      ],
      explanation: "Finds relevant patterns about API rate limiting",
    },
  ],
};

async function searchSemanticMemoryHandler(params: Record<string, any>, context?: { namespace?: string }) {
  const namespace = context?.namespace || "rebecca";
  const memory = new MemoryManager(namespace);
  const results = await memory.searchKnowledge(
    params.query,
    params.limit || 5,
    params.min_confidence || 0.3
  );
  return results;
}

// ========== SEARCH EPISODIC MEMORY ==========

export const searchEpisodicMemoryTool: Tool = {
  name: "search_episodic_memory",
  description: "Search through episodic memory (past experiences and events) to find similar situations",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query to find similar past experiences",
      required: true,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum number of episodes to return",
      required: false,
      default: 5,
    },
  ],
  returns: "Array of past episodes with goals, outcomes, steps taken, and timestamps",
  examples: [
    {
      input: { query: "Failed API requests", limit: 3 },
      output: [
        {
          goal: "Call external API",
          outcome: "failure",
          steps_taken: ["Attempted connection", "Received timeout"],
          timestamp: "2024-10-01T10:00:00Z",
        },
      ],
      explanation: "Finds past experiences with failed API requests",
    },
  ],
};

async function searchEpisodicMemoryHandler(params: Record<string, any>, context?: { namespace?: string }) {
  const namespace = context?.namespace || "rebecca";
  const memory = new MemoryManager(namespace);
  const results = await memory.searchEpisodes(params.query, params.limit || 5);
  return results;
}

// ========== SAVE KNOWLEDGE ==========

export const saveKnowledgeTool: Tool = {
  name: "save_knowledge",
  description: "Save new knowledge to semantic memory for future reference",
  parameters: [
    {
      name: "content",
      type: "string",
      description: "The knowledge content to save",
      required: true,
    },
    {
      name: "kind",
      type: "string",
      description: "Type of knowledge: fact, skill, pattern, knowledge, or guideline",
      required: true,
    },
    {
      name: "confidence",
      type: "number",
      description: "Confidence score (0.0 to 1.0)",
      required: false,
      default: 0.7,
    },
    {
      name: "source",
      type: "string",
      description: "Source of knowledge: learned, provided, or inferred",
      required: false,
      default: "learned",
    },
  ],
  returns: "ID of the saved knowledge entry",
  examples: [
    {
      input: {
        content: "User prefers JSON responses over XML",
        kind: "pattern",
        confidence: 0.9,
      },
      output: "uuid-123-456",
      explanation: "Saves user preference as a pattern",
    },
  ],
};

async function saveKnowledgeHandler(params: Record<string, any>, context?: { namespace?: string }) {
  const namespace = context?.namespace || "rebecca";
  const memory = new MemoryManager(namespace);
  const id = await memory.saveKnowledge({
    content: params.content,
    kind: params.kind as any,
    confidence: params.confidence || 0.7,
    source: (params.source as any) || "learned",
  });
  return { id, message: "Knowledge saved successfully" };
}

// ========== GET RECENT EPISODES ==========

export const getRecentEpisodesTool: Tool = {
  name: "get_recent_episodes",
  description: "Get the most recent episodes from episodic memory",
  parameters: [
    {
      name: "limit",
      type: "number",
      description: "Number of recent episodes to retrieve",
      required: false,
      default: 10,
    },
  ],
  returns: "Array of recent episodes ordered by timestamp",
};

async function getRecentEpisodesHandler(params: Record<string, any>, context?: { namespace?: string }) {
  const namespace = context?.namespace || "rebecca";
  const memory = new MemoryManager(namespace);
  const results = await memory.getRecentEpisodes(params.limit || 10);
  return results;
}

// ========== GET KNOWLEDGE BY KIND ==========

export const getKnowledgeByKindTool: Tool = {
  name: "get_knowledge_by_kind",
  description: "Get all knowledge of a specific type (fact, skill, pattern, knowledge, guideline)",
  parameters: [
    {
      name: "kind",
      type: "string",
      description: "Type of knowledge to retrieve",
      required: true,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum number of items to return",
      required: false,
      default: 20,
    },
  ],
  returns: "Array of knowledge items of the specified kind",
};

async function getKnowledgeByKindHandler(params: Record<string, any>, context?: { namespace?: string }) {
  const namespace = context?.namespace || "rebecca";
  const memory = new MemoryManager(namespace);
  const results = await memory.getKnowledgeByKind(params.kind as any, params.limit || 20);
  return results;
}

// ========== РЕГИСТРАЦИЯ ИНСТРУМЕНТОВ ==========

export function registerMemoryTools() {
  globalToolRegistry.register(searchSemanticMemoryTool, searchSemanticMemoryHandler);
  globalToolRegistry.register(searchEpisodicMemoryTool, searchEpisodicMemoryHandler);
  globalToolRegistry.register(saveKnowledgeTool, saveKnowledgeHandler);
  globalToolRegistry.register(getRecentEpisodesTool, getRecentEpisodesHandler);
  globalToolRegistry.register(getKnowledgeByKindTool, getKnowledgeByKindHandler);
}
