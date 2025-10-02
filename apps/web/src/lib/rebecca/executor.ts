// apps/web/src/lib/rebecca/executor.ts
import { LLMProvider } from "./llm-provider";
import { ToolRegistry } from "./tools/registry";
import type { Plan, PlanStep, WorkingMemory, ToolCall } from "./types";

/**
 * PlanExecutor - выполнение плана шаг за шагом
 * 
 * Проверяет зависимости, вызывает инструменты, обрабатывает ошибки
 */
export class PlanExecutor {
  private toolRegistry: ToolRegistry;
  private maxRetries = 2;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Выполнить план полностью
   */
  async executePlan(
    plan: Plan,
    workingMemory: WorkingMemory
  ): Promise<{ success: boolean; completedSteps: PlanStep[]; finalOutput: any }> {
    const completedSteps: PlanStep[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      
      // Проверяем зависимости
      if (!this.areDependenciesMet(step, completedSteps)) {
        console.warn(`Skipping step ${step.id}: dependencies not met`);
        step.status = "skipped";
        continue;
      }

      // Выполняем шаг
      step.status = "in_progress";
      workingMemory.currentStep = i;

      const result = await this.executeStep(step, workingMemory);

      if (result.success) {
        step.status = "completed";
        completedSteps.push(step);
        
        // Записываем результат в scratchpad
        workingMemory.scratchpad.push(
          `Step ${step.id} completed: ${step.description} → ${JSON.stringify(result.output).slice(0, 100)}`
        );
      } else {
        step.status = "failed";
        
        // Попытка повтора
        if (result.retriesLeft > 0) {
          console.log(`Retrying step ${step.id}...`);
          const retryResult = await this.executeStep(step, workingMemory);
          
          if (retryResult.success) {
            step.status = "completed";
            completedSteps.push(step);
          } else {
            console.error(`Step ${step.id} failed after retries`);
            // Продолжаем выполнение остальных шагов (best effort)
          }
        }
      }
    }

    // Собираем финальный output из scratchpad
    const finalOutput = {
      goal: plan.goal,
      steps_completed: completedSteps.length,
      total_steps: plan.steps.length,
      scratchpad: workingMemory.scratchpad,
      tool_results: workingMemory.toolResults,
    };

    return {
      success: completedSteps.length > 0,
      completedSteps,
      finalOutput,
    };
  }

  /**
   * Выполнить один шаг плана
   */
  private async executeStep(
    step: PlanStep,
    workingMemory: WorkingMemory
  ): Promise<{ success: boolean; output?: any; retriesLeft: number }> {
    try {
      // Если у шага есть назначенный инструмент
      if (step.tool && this.toolRegistry.has(step.tool)) {
        return await this.executeToolStep(step, workingMemory);
      }

      // Иначе используем LLM для выполнения
      return await this.executeLLMStep(step, workingMemory);
    } catch (error: any) {
      console.error(`Error executing step ${step.id}:`, error);
      return {
        success: false,
        output: error.message,
        retriesLeft: this.maxRetries - 1,
      };
    }
  }

  /**
   * Выполнить шаг с использованием инструмента
   */
  private async executeToolStep(
    step: PlanStep,
    workingMemory: WorkingMemory
  ): Promise<{ success: boolean; output?: any; retriesLeft: number }> {
    // Используем LLM для определения параметров инструмента
    const tool = this.toolRegistry.getTool(step.tool!);
    if (!tool) {
      return {
        success: false,
        output: `Tool ${step.tool} not found`,
        retriesLeft: 0,
      };
    }

    const systemMessage = `You are an AI agent executing a step in a plan. Generate parameters for the following tool:

Tool: ${tool.name}
Description: ${tool.description}
Parameters: ${JSON.stringify(tool.parameters, null, 2)}

Current step: ${step.description}
Expected output: ${step.expected_output || "Not specified"}

Respond with a JSON object containing the tool parameters only.`;

    const contextStr = workingMemory.scratchpad.length > 0
      ? `\n\nContext from previous steps:\n${workingMemory.scratchpad.slice(-3).join("\n")}`
      : "";

    const userPrompt = `Generate parameters for tool "${tool.name}" to complete: ${step.description}${contextStr}`;

    try {
      // Получаем параметры от LLM
      const response = await LLMProvider.ask(userPrompt, systemMessage, {
        temperature: 0.2,
        maxTokens: 500,
      });

      // Пытаемся извлечь JSON
      let params: Record<string, any> = {};
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          params = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Если не удалось распарсить, используем пустые параметры
        params = {};
      }

      // Вызываем инструмент
      const toolCall: ToolCall = {
        tool_name: tool.name,
        parameters: params,
        reasoning: step.description,
      };

      const toolResult = await this.toolRegistry.execute(toolCall);
      workingMemory.toolResults.push(toolResult);

      return {
        success: toolResult.success,
        output: toolResult.result,
        retriesLeft: this.maxRetries - 1,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        retriesLeft: this.maxRetries - 1,
      };
    }
  }

  /**
   * Выполнить шаг с использованием только LLM (без инструментов)
   */
  private async executeLLMStep(
    step: PlanStep,
    workingMemory: WorkingMemory
  ): Promise<{ success: boolean; output?: any; retriesLeft: number }> {
    const systemMessage = `You are an AI agent executing a step in a plan. Complete the following step to the best of your ability.`;

    const contextStr = workingMemory.scratchpad.length > 0
      ? `\n\nContext from previous steps:\n${workingMemory.scratchpad.slice(-3).join("\n")}`
      : "";

    const userPrompt = `Step to complete: ${step.description}

Expected output: ${step.expected_output || "Provide a helpful response"}${contextStr}

Complete this step now.`;

    try {
      const response = await LLMProvider.ask(userPrompt, systemMessage, {
        temperature: 0.5,
        maxTokens: 1000,
      });

      return {
        success: true,
        output: response,
        retriesLeft: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        retriesLeft: this.maxRetries - 1,
      };
    }
  }

  /**
   * Проверить, выполнены ли зависимости для шага
   */
  private areDependenciesMet(step: PlanStep, completedSteps: PlanStep[]): boolean {
    if (!step.dependencies || step.dependencies.length === 0) {
      return true;
    }

    const completedIds = new Set(completedSteps.map((s) => s.id));
    return step.dependencies.every((depId) => completedIds.has(depId));
  }
}
