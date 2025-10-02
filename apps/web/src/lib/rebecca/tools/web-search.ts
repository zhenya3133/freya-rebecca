// apps/web/src/lib/rebecca/tools/web-search.ts
import type { Tool } from "../types";
import { globalToolRegistry } from "./registry";

/**
 * Web Search Tool - поиск в интернете
 * 
 * MVP: Заглушка с TODO
 * Будущая интеграция: Tavily, Serper, Brave Search API
 */

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web for information using a search engine",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query",
      required: true,
    },
    {
      name: "num_results",
      type: "number",
      description: "Number of search results to return",
      required: false,
      default: 5,
    },
  ],
  returns: "Array of search results with title, url, and snippet",
  examples: [
    {
      input: { query: "AI agents architecture patterns", num_results: 3 },
      output: [
        {
          title: "Building AI Agents - A Guide",
          url: "https://example.com/ai-agents",
          snippet: "Learn how to build AI agents with...",
        },
      ],
      explanation: "Returns top search results for the query",
    },
  ],
};

async function webSearchHandler(params: Record<string, any>) {
  // TODO: Интеграция с реальным API поиска
  // Варианты:
  // 1. Tavily API: https://tavily.com/
  // 2. Serper API: https://serper.dev/
  // 3. Brave Search API: https://brave.com/search/api/
  // 4. Google Custom Search API
  
  console.warn("web_search: TODO - implement real search API integration");

  // Пока возвращаем заглушку
  return {
    results: [],
    message: "Web search not yet implemented. Please integrate Tavily, Serper, or Brave Search API.",
    query: params.query,
  };
}

export function registerWebSearchTool() {
  globalToolRegistry.register(webSearchTool, webSearchHandler);
}
