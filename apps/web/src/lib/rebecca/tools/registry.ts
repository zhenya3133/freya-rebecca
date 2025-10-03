// apps/web/src/lib/rebecca/tools/registry.ts
import type { Tool, ToolCall, ToolResult } from "../types";

/**
 * Тип функции-обработчика инструмента
 */
export type ToolHandler = (params: Record<string, any>) => Promise<any>;

/**
 * Tool Registry - реестр доступных инструментов для Rebecca
 * 
 * Позволяет регистрировать новые инструменты и вызывать их
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  /**
   * Зарегистрировать новый инструмент
   */
  register(tool: Tool, handler: ToolHandler): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool '${tool.name}' is already registered. Overwriting.`);
    }

    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  /**
   * Получить информацию об инструменте
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Получить список всех доступных инструментов
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Получить список инструментов в текстовом виде (для промпта LLM)
   */
  getToolsDescription(): string {
    const tools = this.getAllTools();
    
    if (tools.length === 0) {
      return "No tools available.";
    }

    return tools.map((tool) => {
      const params = tool.parameters
        .map((p) => {
          const required = p.required ? " (required)" : " (optional)";
          const defaultValue = p.default !== undefined ? ` [default: ${p.default}]` : "";
          return `  - ${p.name} (${p.type})${required}: ${p.description}${defaultValue}`;
        })
        .join("\n");

      const examples = tool.examples
        ? "\n  Examples:\n" +
          tool.examples
            .map((ex) => `    Input: ${JSON.stringify(ex.input)}\n    Output: ${JSON.stringify(ex.output)}\n    ${ex.explanation}`)
            .join("\n")
        : "";

      return `${tool.name}:\n  Description: ${tool.description}\n  Parameters:\n${params}\n  Returns: ${tool.returns}${examples}`;
    }).join("\n\n");
  }

  /**
   * Валидация параметров перед вызовом инструмента
   */
  private validateParameters(tool: Tool, params: Record<string, any>): void {
    for (const param of tool.parameters) {
      // Проверка обязательных параметров
      if (param.required && !(param.name in params)) {
        throw new Error(
          `Missing required parameter '${param.name}' for tool '${tool.name}'`
        );
      }

      // Установка значений по умолчанию
      if (!(param.name in params) && param.default !== undefined) {
        params[param.name] = param.default;
      }

      // Проверка типов (базовая)
      if (param.name in params) {
        const value = params[param.name];
        const actualType = Array.isArray(value) ? "array" : typeof value;
        const expectedType = param.type;

        if (actualType !== expectedType && value !== null && value !== undefined) {
          console.warn(
            `Type mismatch for parameter '${param.name}' in tool '${tool.name}': expected ${expectedType}, got ${actualType}`
          );
        }
      }
    }
  }

  /**
   * Выполнить инструмент
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    const tool = this.getTool(call.tool_name);
    if (!tool) {
      return {
        tool_name: call.tool_name,
        parameters: call.parameters,
        result: null,
        success: false,
        error: `Tool '${call.tool_name}' not found`,
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      };
    }

    const handler = this.handlers.get(call.tool_name);
    if (!handler) {
      return {
        tool_name: call.tool_name,
        parameters: call.parameters,
        result: null,
        success: false,
        error: `Handler not found for tool '${call.tool_name}'`,
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      };
    }

    try {
      // Валидация параметров
      this.validateParameters(tool, call.parameters);

      // Выполнение
      const result = await handler(call.parameters);

      return {
        tool_name: call.tool_name,
        parameters: call.parameters,
        result,
        success: true,
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      };
    } catch (error: any) {
      return {
        tool_name: call.tool_name,
        parameters: call.parameters,
        result: null,
        success: false,
        error: error.message || String(error),
        duration_ms: Date.now() - startTime,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Проверить, зарегистрирован ли инструмент
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Удалить инструмент из реестра
   */
  unregister(name: string): boolean {
    const toolExists = this.tools.has(name);
    this.tools.delete(name);
    this.handlers.delete(name);
    return toolExists;
  }

  /**
   * Очистить все инструменты
   */
  clear(): void {
    this.tools.clear();
    this.handlers.clear();
  }

  /**
   * Получить количество зарегистрированных инструментов
   */
  get size(): number {
    return this.tools.size;
  }
}

/**
 * Глобальный реестр инструментов (singleton)
 */
export const globalToolRegistry = new ToolRegistry();
