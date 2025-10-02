// apps/web/src/lib/rebecca/index.ts
/**
 * Rebecca AI Agent - Main exports
 * 
 * Three-memory architecture: Working, Episodic, Semantic
 * Planning system with LLM-based decomposition
 * Tool registry for extensible capabilities
 */

// Main agent
export { RebeccaAgent } from "./agent";

// Memory system
export { MemoryManager } from "./memory-manager";

// Planning
export { Planner } from "./planner";
export { PlanExecutor } from "./executor";

// LLM provider
export { LLMProvider, extractJSON, askForJSON } from "./llm-provider";
export type { Message, ChatOptions, ChatResponse } from "./llm-provider";

// Tool system
export { ToolRegistry, globalToolRegistry } from "./tools/registry";
export type { ToolHandler } from "./tools/registry";
export { registerMemoryTools } from "./tools/memory-tools";
export { registerWebSearchTool } from "./tools/web-search";
export { registerFileLoaderTools } from "./tools/file-loader";

// Types
export type {
  WorkingMemory,
  EpisodicMemory,
  SemanticMemory,
  Plan,
  PlanStep,
  Tool,
  ToolParameter,
  ToolExample,
  ToolCall,
  ToolResult,
  Reflection,
  AgentState,
  ExecutionResult,
} from "./types";
