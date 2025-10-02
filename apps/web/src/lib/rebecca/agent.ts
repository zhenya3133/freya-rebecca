// apps/web/src/lib/rebecca/agent.ts
import { v4 as uuidv4 } from "uuid";
import { MemoryManager } from "./memory-manager";
import { LLMProvider } from "./llm-provider";
import { Planner } from "./planner";
import { PlanExecutor } from "./executor";
import { ToolRegistry, globalToolRegistry } from "./tools/registry";
import { registerMemoryTools } from "./tools/memory-tools";
import { registerWebSearchTool } from "./tools/web-search";
import { registerFileLoaderTools } from "./tools/file-loader";
import type { ExecutionResult, WorkingMemory, Plan } from "./types";
import { q } from "../db";

/**
 * RebeccaAgent - главный оркестратор AI агента
 * 
 * Объединяет все подсистемы:
 * - Memory Manager (три вида памяти)
 * - Planner (декомпозиция целей)
 * - Executor (выполнение плана)
 * - Tool Registry (инструменты)
 * 
 * Основной цикл: Initialize → Plan → Execute → (Reflect) → (Learn) → Return
 */
export class RebeccaAgent {
  private sessionId: string;
  private namespace: string;
  private memory: MemoryManager;
  private planner: Planner;
  private executor: PlanExecutor;
  private toolRegistry: ToolRegistry;

  constructor(namespace = "rebecca") {
    this.sessionId = uuidv4();
    this.namespace = namespace;
    this.memory = new MemoryManager(namespace);
    this.toolRegistry = globalToolRegistry;
    this.planner = new Planner(this.toolRegistry);
    this.executor = new PlanExecutor(this.toolRegistry);

    // Регистрируем все инструменты
    this.registerTools();
  }

  /**
   * Регистрация всех доступных инструментов
   */
  private registerTools() {
    registerMemoryTools();
    registerWebSearchTool();
    registerFileLoaderTools();
  }

  /**
   * Главный метод: выполнить задачу
   */
  async execute(goal: string, context?: Record<string, any>): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    console.log(`[Rebecca] Starting execution for goal: ${goal}`);
    console.log(`[Rebecca] Session ID: ${this.sessionId}`);
    console.log(`[Rebecca] LLM Provider: ${JSON.stringify(LLMProvider.getConfig())}`);

    try {
      // 1. INITIALIZE - создать working memory
      const workingMemory = this.memory.createWorkingMemory(goal);
      this.memory.addToScratchpad(workingMemory, `Initialized session ${this.sessionId}`);

      if (context) {
        workingMemory.context = context;
        this.memory.addToScratchpad(workingMemory, `Received context: ${JSON.stringify(context)}`);
      }

      // Сохраняем начало сессии в БД
      await this.saveSessionStart(goal);

      // Загружаем релевантный контекст из semantic memory
      await this.loadRelevantContext(goal, workingMemory);

      // 2. PLAN - создать план действий
      this.memory.addToScratchpad(workingMemory, "Creating execution plan...");
      
      const needsPlan = await this.planner.needsPlanning(goal);
      let plan: Plan;

      if (needsPlan) {
        plan = await this.planner.createPlan(goal, context);
        this.memory.addToScratchpad(
          workingMemory,
          `Plan created: ${plan.steps.length} steps, complexity: ${plan.estimated_complexity}`
        );
      } else {
        // Простая задача - LLM напрямую
        this.memory.addToScratchpad(workingMemory, "Simple goal, executing directly with LLM");
        const response = await LLMProvider.ask(goal, undefined, { maxTokens: 2000 });
        
        plan = {
          goal,
          steps: [],
          estimated_complexity: "simple",
          confidence: 0.9,
        };

        const duration = Date.now() - startTime;
        
        // Сохраняем в episodic memory
        await this.memory.saveEpisode({
          event_type: "task_completed",
          goal,
          outcome: "success",
          steps_taken: ["Direct LLM response"],
          duration_ms: duration,
        });

        await this.saveSessionEnd("completed", { direct_response: response }, duration);

        return {
          success: true,
          goal,
          plan,
          steps_completed: [],
          final_output: response,
          reflections: {
            task_id: this.sessionId,
            timestamp: new Date(),
            what_worked: ["Direct LLM approach"],
            what_failed: [],
            lessons_learned: [],
            suggestions: [],
            confidence_before: 0.9,
            confidence_after: 0.9,
          },
          working_memory_snapshot: workingMemory,
          duration_ms: duration,
        };
      }

      workingMemory.plan = plan.steps.map((s) => s.description);

      // 3. EXECUTE - выполнить план
      this.memory.addToScratchpad(workingMemory, "Executing plan...");
      
      const executionResult = await this.executor.executePlan(plan, workingMemory);

      const duration = Date.now() - startTime;

      // Сохраняем результаты в episodic memory
      const outcome = executionResult.success ? "success" : "failure";
      await this.memory.saveEpisode({
        event_type: "task_completed",
        goal,
        outcome,
        steps_taken: executionResult.completedSteps.map((s) => s.description),
        duration_ms: duration,
        metadata: {
          session_id: this.sessionId,
          total_steps: plan.steps.length,
          completed_steps: executionResult.completedSteps.length,
        },
      });

      // Сохраняем tool executions в БД
      for (const toolResult of workingMemory.toolResults) {
        await this.memory.saveToolExecution(this.sessionId, toolResult);
      }

      // 4. REFLECT (заглушка для MVP)
      const reflections = {
        task_id: this.sessionId,
        timestamp: new Date(),
        what_worked: executionResult.completedSteps.map((s) => s.description),
        what_failed: plan.steps
          .filter((s) => s.status === "failed")
          .map((s) => s.description),
        lessons_learned: [],
        suggestions: [],
        confidence_before: plan.confidence,
        confidence_after: executionResult.success ? plan.confidence : plan.confidence - 0.2,
      };

      // 5. LEARN (заглушка для MVP - в будущем обновим semantic memory на основе рефлексий)

      // Сохраняем финальное состояние сессии
      await this.saveSessionEnd(
        executionResult.success ? "completed" : "failed",
        executionResult.finalOutput,
        duration
      );

      return {
        success: executionResult.success,
        goal,
        plan,
        steps_completed: executionResult.completedSteps,
        final_output: executionResult.finalOutput,
        reflections,
        working_memory_snapshot: workingMemory,
        duration_ms: duration,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      console.error("[Rebecca] Execution error:", error);

      // Сохраняем ошибку в episodic memory
      await this.memory.saveEpisode({
        event_type: "task_failed",
        goal,
        outcome: "failure",
        steps_taken: ["Error during execution"],
        duration_ms: duration,
        metadata: {
          error: error.message,
          session_id: this.sessionId,
        },
      });

      await this.saveSessionEnd("failed", null, duration);

      return {
        success: false,
        goal,
        plan: {
          goal,
          steps: [],
          estimated_complexity: "unknown" as any,
          confidence: 0,
        },
        steps_completed: [],
        final_output: null,
        reflections: {
          task_id: this.sessionId,
          timestamp: new Date(),
          what_worked: [],
          what_failed: [error.message],
          lessons_learned: [],
          suggestions: [],
          confidence_before: 0.5,
          confidence_after: 0.3,
        },
        working_memory_snapshot: this.memory.createWorkingMemory(goal),
        duration_ms: duration,
        error: error.message,
      };
    }
  }

  /**
   * Загрузить релевантный контекст из semantic memory
   */
  private async loadRelevantContext(goal: string, workingMemory: WorkingMemory): Promise<void> {
    try {
      // Ищем похожие прошлые эпизоды
      const similarEpisodes = await this.memory.searchEpisodes(goal, 3);
      
      if (similarEpisodes.length > 0) {
        this.memory.addToScratchpad(
          workingMemory,
          `Found ${similarEpisodes.length} similar past episodes`
        );
        workingMemory.context.past_episodes = similarEpisodes;
      }

      // Ищем релевантные знания
      const relevantKnowledge = await this.memory.searchKnowledge(goal, 5, 0.5);
      
      if (relevantKnowledge.length > 0) {
        this.memory.addToScratchpad(
          workingMemory,
          `Found ${relevantKnowledge.length} relevant knowledge items`
        );
        workingMemory.context.relevant_knowledge = relevantKnowledge;
      }
    } catch (error) {
      console.warn("Failed to load context from memory:", error);
    }
  }

  /**
   * Сохранить начало сессии в БД
   */
  private async saveSessionStart(goal: string): Promise<void> {
    try {
      await q(
        `INSERT INTO agent_sessions 
         (session_id, namespace, goal, status, started_at)
         VALUES ($1, $2, $3, 'active', NOW())`,
        [this.sessionId, this.namespace, goal]
      );
    } catch (error) {
      console.error("Failed to save session start:", error);
    }
  }

  /**
   * Сохранить завершение сессии в БД
   */
  private async saveSessionEnd(
    status: "completed" | "failed" | "abandoned",
    finalOutput: any,
    duration: number
  ): Promise<void> {
    try {
      await q(
        `UPDATE agent_sessions 
         SET status = $1, 
             final_output = $2, 
             duration_ms = $3, 
             completed_at = NOW()
         WHERE session_id = $4`,
        [status, JSON.stringify(finalOutput), duration, this.sessionId]
      );
    } catch (error) {
      console.error("Failed to save session end:", error);
    }
  }

  /**
   * Получить информацию о сессии
   */
  getSessionInfo() {
    return {
      session_id: this.sessionId,
      namespace: this.namespace,
      tools_available: this.toolRegistry.getAllTools().map((t) => t.name),
      llm_config: LLMProvider.getConfig(),
    };
  }
}
