// apps/web/src/lib/rebecca/planner.ts
import { LLMProvider, askForJSON } from "./llm-provider";
import { ToolRegistry } from "./tools/registry";
import type { Plan, PlanStep } from "./types";
import { v4 as uuidv4 } from "uuid";

/**
 * Planner - декомпозиция целей на последовательность шагов
 * 
 * Использует LLM для анализа задачи и генерации плана действий
 */
export class Planner {
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Создать план для достижения цели
   */
  async createPlan(goal: string, context?: Record<string, any>): Promise<Plan> {
    // Получаем описание доступных инструментов
    const toolsDescription = this.toolRegistry.getToolsDescription();

    // Формируем промпт для LLM
    const systemMessage = `You are an AI planning agent. Your job is to break down complex goals into a sequence of executable steps.

Available tools:
${toolsDescription}

IMPORTANT:
- Each step should be concrete and actionable
- Steps can have dependencies on other steps (use step IDs)
- Assign appropriate tools to steps when applicable
- Estimate complexity: simple, moderate, or complex
- Provide confidence score (0.0 to 1.0)

Respond with a JSON object following this structure:
{
  "steps": [
    {
      "id": "step-1",
      "description": "Clear description of what to do",
      "dependencies": [],
      "tool": "tool_name_if_applicable",
      "expected_output": "What this step should produce"
    }
  ],
  "estimated_complexity": "simple|moderate|complex",
  "confidence": 0.85
}`;

    const contextStr = context && Object.keys(context).length > 0
      ? `\n\nAdditional context:\n${JSON.stringify(context, null, 2)}`
      : "";

    const userPrompt = `Goal: ${goal}${contextStr}

Create a step-by-step plan to achieve this goal. Be specific and realistic.`;

    try {
      const response = await askForJSON<{
        steps: Array<{
          id?: string;
          description: string;
          dependencies?: string[];
          tool?: string;
          expected_output?: string;
        }>;
        estimated_complexity?: string;
        confidence?: number;
      }>(userPrompt, systemMessage, {
        temperature: 0.3,
        maxTokens: 2000,
      });

      if (!response || !response.steps || !Array.isArray(response.steps)) {
        throw new Error("Invalid plan response from LLM");
      }

      // Преобразуем в структуру Plan
      const steps: PlanStep[] = response.steps.map((step, index) => ({
        id: step.id || `step-${index + 1}`,
        description: step.description,
        dependencies: step.dependencies || [],
        tool: step.tool,
        expected_output: step.expected_output,
        status: "pending" as const,
      }));

      const plan: Plan = {
        goal,
        steps,
        estimated_complexity: (response.estimated_complexity as any) || "moderate",
        confidence: response.confidence || 0.7,
      };

      return plan;
    } catch (error: any) {
      console.error("Failed to create plan:", error);
      
      // Fallback: простой план из одного шага
      return {
        goal,
        steps: [
          {
            id: "step-1",
            description: `Complete goal: ${goal}`,
            dependencies: [],
            status: "pending",
          },
        ],
        estimated_complexity: "simple",
        confidence: 0.5,
      };
    }
  }

  /**
   * Переплан ировать (если текущий план провалился)
   */
  async replan(
    originalGoal: string,
    failedPlan: Plan,
    failureReason: string
  ): Promise<Plan> {
    const systemMessage = `You are an AI planning agent. A previous plan failed, and you need to create a new, improved plan.

Available tools:
${this.toolRegistry.getToolsDescription()}

Consider what went wrong and adjust the approach accordingly.`;

    const userPrompt = `Original goal: ${originalGoal}

Previous plan that failed:
${JSON.stringify(failedPlan.steps, null, 2)}

Failure reason: ${failureReason}

Create a new plan that addresses the failure. Be more cautious and specific.`;

    try {
      const response = await askForJSON<{
        steps: Array<{
          id?: string;
          description: string;
          dependencies?: string[];
          tool?: string;
          expected_output?: string;
        }>;
        estimated_complexity?: string;
        confidence?: number;
      }>(userPrompt, systemMessage, {
        temperature: 0.4,
        maxTokens: 2000,
      });

      if (!response || !response.steps) {
        throw new Error("Invalid replan response");
      }

      const steps: PlanStep[] = response.steps.map((step, index) => ({
        id: step.id || `replan-step-${index + 1}`,
        description: step.description,
        dependencies: step.dependencies || [],
        tool: step.tool,
        expected_output: step.expected_output,
        status: "pending" as const,
      }));

      return {
        goal: originalGoal,
        steps,
        estimated_complexity: (response.estimated_complexity as any) || "moderate",
        confidence: (response.confidence || 0.6) - 0.1, // Снижаем уверенность после провала
      };
    } catch (error) {
      console.error("Failed to replan:", error);
      
      // Возвращаем упрощённый план
      return {
        goal: originalGoal,
        steps: [
          {
            id: "fallback-step",
            description: `Attempt to complete: ${originalGoal} (simplified approach)`,
            dependencies: [],
            status: "pending",
          },
        ],
        estimated_complexity: "simple",
        confidence: 0.4,
      };
    }
  }

  /**
   * Оценить, нужно ли планирование для данной цели
   */
  async needsPlanning(goal: string): Promise<boolean> {
    // Простые эвристики
    const simplePatterns = [
      /^what is/i,
      /^who is/i,
      /^when did/i,
      /^where is/i,
      /^define/i,
    ];

    if (simplePatterns.some((pattern) => pattern.test(goal))) {
      return false;
    }

    // Если цель короткая и простая
    if (goal.length < 50 && !goal.includes("and") && !goal.includes(",")) {
      return false;
    }

    return true;
  }
}
