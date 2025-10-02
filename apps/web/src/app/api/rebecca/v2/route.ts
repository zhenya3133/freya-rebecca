// apps/web/src/app/api/rebecca/v2/route.ts
import { NextResponse } from "next/server";
import { RebeccaAgent } from "@/lib/rebecca/agent";

/**
 * Rebecca Agent API v2
 * 
 * POST /api/rebecca/v2
 * 
 * Request Body:
 * {
 *   goal: string,              // Цель для выполнения
 *   namespace?: string,        // Namespace для памяти (по умолчанию "rebecca")
 *   context?: Record<string, any>  // Дополнительный контекст
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   session_id: string,
 *   goal: string,
 *   plan: Plan,
 *   steps_completed: PlanStep[],
 *   final_output: any,
 *   reflections: Reflection,
 *   duration_ms: number,
 *   tokens_used?: number,
 *   error?: string
 * }
 */

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { goal, namespace, context } = body;

    // Валидация входных данных
    if (!goal || typeof goal !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "Missing or invalid 'goal' parameter. Must be a non-empty string.",
        },
        { status: 400 }
      );
    }

    if (goal.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Goal cannot be empty",
        },
        { status: 400 }
      );
    }

    // Создаём агента
    const agent = new RebeccaAgent(namespace || "rebecca");

    console.log("[API v2] Starting Rebecca execution...");
    console.log("[API v2] Goal:", goal);
    console.log("[API v2] Session:", agent.getSessionInfo().session_id);

    // Выполняем задачу
    const result = await agent.execute(goal, context);

    console.log(
      `[API v2] Execution completed: ${result.success ? "SUCCESS" : "FAILURE"} in ${result.duration_ms}ms`
    );

    // Формируем ответ
    const response = {
      success: result.success,
      session_id: agent.getSessionInfo().session_id,
      goal: result.goal,
      plan: {
        steps: result.plan.steps.map((step) => ({
          id: step.id,
          description: step.description,
          status: step.status,
          tool: step.tool,
        })),
        estimated_complexity: result.plan.estimated_complexity,
        confidence: result.plan.confidence,
      },
      steps_completed: result.steps_completed.map((step) => ({
        id: step.id,
        description: step.description,
        status: step.status,
      })),
      final_output: result.final_output,
      reflections: {
        what_worked: result.reflections.what_worked,
        what_failed: result.reflections.what_failed,
        confidence_before: result.reflections.confidence_before,
        confidence_after: result.reflections.confidence_after,
      },
      duration_ms: result.duration_ms,
      tokens_used: result.tokens_used,
      error: result.error,
    };

    return NextResponse.json(response, {
      status: result.success ? 200 : 500,
    });
  } catch (error: any) {
    console.error("[API v2] Unexpected error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    version: "2.0",
    name: "Rebecca Agent API",
    description: "AI Agent with three memory types, planning, and tool use",
  });
}
