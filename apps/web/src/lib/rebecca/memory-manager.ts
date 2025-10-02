// apps/web/src/lib/rebecca/memory-manager.ts
import { q } from "../db";
import { embedMany, toVectorLiteral } from "../embeddings";
import type {
  WorkingMemory,
  EpisodicMemory,
  SemanticMemory,
  ToolResult,
} from "./types";

/**
 * MemoryManager - управление тремя видами памяти Rebecca
 * 
 * 1. Working Memory - в RAM, только во время выполнения задачи
 * 2. Episodic Memory - в БД, события и опыт
 * 3. Semantic Memory - в БД, долгосрочные знания
 */
export class MemoryManager {
  private namespace: string;

  constructor(namespace = "rebecca") {
    this.namespace = namespace;
  }

  // ========== WORKING MEMORY (RAM) ==========

  /**
   * Создать новую рабочую память для задачи
   */
  createWorkingMemory(goal: string): WorkingMemory {
    return {
      goal,
      plan: [],
      currentStep: 0,
      context: {},
      scratchpad: [],
      toolResults: [],
    };
  }

  /**
   * Добавить запись в scratchpad (промежуточные размышления)
   */
  addToScratchpad(wm: WorkingMemory, note: string): void {
    wm.scratchpad.push(`[${new Date().toISOString()}] ${note}`);
  }

  /**
   * Добавить результат вызова инструмента
   */
  addToolResult(wm: WorkingMemory, result: ToolResult): void {
    wm.toolResults.push(result);
  }

  // ========== EPISODIC MEMORY (Events & Experience) ==========

  /**
   * Сохранить событие в эпизодическую память
   */
  async saveEpisode(params: {
    event_type: "task_completed" | "task_failed" | "tool_used" | "user_interaction" | "learning";
    goal: string;
    outcome: "success" | "failure" | "partial";
    steps_taken: string[];
    duration_ms: number;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const { event_type, goal, outcome, steps_taken, duration_ms, metadata = {} } = params;

    // Создаём embedding для события (цель + шаги)
    const text = `${goal}\n${steps_taken.join("\n")}`;
    const [embedding] = await embedMany([text]);

    const rows = await q<{ id: string }>(
      `INSERT INTO episodic_memory 
       (namespace, event_type, goal, outcome, steps_taken, duration_ms, metadata, embedding, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING id`,
      [
        this.namespace,
        event_type,
        goal,
        outcome,
        JSON.stringify(steps_taken),
        duration_ms,
        JSON.stringify(metadata),
        toVectorLiteral(embedding),
      ]
    );

    return rows[0].id;
  }

  /**
   * Поиск похожих эпизодов по embedding (семантический поиск)
   */
  async searchEpisodes(query: string, limit = 5): Promise<EpisodicMemory[]> {
    const [queryEmbedding] = await embedMany([query]);

    const rows = await q<any>(
      `SELECT 
        id, 
        timestamp, 
        event_type, 
        goal, 
        outcome, 
        steps_taken, 
        duration_ms, 
        metadata,
        (embedding <=> $1::vector) as distance
       FROM episodic_memory
       WHERE namespace = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [toVectorLiteral(queryEmbedding), this.namespace, limit]
    );

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: new Date(r.timestamp),
      event_type: r.event_type,
      goal: r.goal,
      outcome: r.outcome,
      steps_taken: JSON.parse(r.steps_taken || "[]"),
      duration_ms: r.duration_ms,
      metadata: r.metadata || {},
    }));
  }

  /**
   * Получить последние N эпизодов по времени
   */
  async getRecentEpisodes(limit = 10): Promise<EpisodicMemory[]> {
    const rows = await q<any>(
      `SELECT 
        id, 
        timestamp, 
        event_type, 
        goal, 
        outcome, 
        steps_taken, 
        duration_ms, 
        metadata
       FROM episodic_memory
       WHERE namespace = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [this.namespace, limit]
    );

    return rows.map((r: any) => ({
      id: r.id,
      timestamp: new Date(r.timestamp),
      event_type: r.event_type,
      goal: r.goal,
      outcome: r.outcome,
      steps_taken: JSON.parse(r.steps_taken || "[]"),
      duration_ms: r.duration_ms,
      metadata: r.metadata || {},
    }));
  }

  // ========== SEMANTIC MEMORY (Knowledge & Facts) ==========

  /**
   * Сохранить знание в семантическую память
   */
  async saveKnowledge(params: {
    kind: "fact" | "skill" | "pattern" | "knowledge" | "guideline";
    content: string;
    confidence?: number;
    source?: "learned" | "provided" | "inferred";
    metadata?: Record<string, any>;
  }): Promise<string> {
    const {
      kind,
      content,
      confidence = 0.5,
      source = "learned",
      metadata = {},
    } = params;

    // Создаём embedding для знания
    const [embedding] = await embedMany([content]);

    const rows = await q<{ id: string }>(
      `INSERT INTO semantic_memory 
       (namespace, kind, content, confidence, source, uses_count, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       RETURNING id`,
      [
        this.namespace,
        kind,
        content,
        confidence,
        source,
        JSON.stringify(metadata),
        toVectorLiteral(embedding),
      ]
    );

    return rows[0].id;
  }

  /**
   * Поиск знаний по embedding (семантический поиск)
   */
  async searchKnowledge(query: string, limit = 5, minConfidence = 0.3): Promise<SemanticMemory[]> {
    const [queryEmbedding] = await embedMany([query]);

    const rows = await q<any>(
      `SELECT 
        id, 
        kind, 
        content, 
        confidence, 
        source, 
        uses_count, 
        last_used, 
        metadata,
        (embedding <=> $1::vector) as distance
       FROM semantic_memory
       WHERE namespace = $2 AND confidence >= $3
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      [toVectorLiteral(queryEmbedding), this.namespace, minConfidence, limit]
    );

    return rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      confidence: r.confidence,
      source: r.source,
      uses_count: r.uses_count,
      last_used: r.last_used ? new Date(r.last_used) : new Date(),
      embedding: [], // не возвращаем embedding (слишком большой)
      metadata: r.metadata || {},
    }));
  }

  /**
   * Обновить confidence и uses_count для знания
   */
  async updateKnowledgeConfidence(id: string, newConfidence: number): Promise<void> {
    await q(
      `UPDATE semantic_memory 
       SET confidence = $1, 
           uses_count = uses_count + 1, 
           last_used = NOW()
       WHERE id = $2 AND namespace = $3`,
      [newConfidence, id, this.namespace]
    );
  }

  /**
   * Инкрементировать счётчик использования знания
   */
  async incrementKnowledgeUse(id: string): Promise<void> {
    await q(
      `UPDATE semantic_memory 
       SET uses_count = uses_count + 1, 
           last_used = NOW()
       WHERE id = $2 AND namespace = $3`,
      [id, this.namespace]
    );
  }

  /**
   * Получить все знания определённого типа
   */
  async getKnowledgeByKind(
    kind: "fact" | "skill" | "pattern" | "knowledge" | "guideline",
    limit = 20
  ): Promise<SemanticMemory[]> {
    const rows = await q<any>(
      `SELECT 
        id, 
        kind, 
        content, 
        confidence, 
        source, 
        uses_count, 
        last_used, 
        metadata
       FROM semantic_memory
       WHERE namespace = $1 AND kind = $2
       ORDER BY confidence DESC, uses_count DESC
       LIMIT $3`,
      [this.namespace, kind, limit]
    );

    return rows.map((r: any) => ({
      id: r.id,
      kind: r.kind,
      content: r.content,
      confidence: r.confidence,
      source: r.source,
      uses_count: r.uses_count,
      last_used: r.last_used ? new Date(r.last_used) : new Date(),
      embedding: [],
      metadata: r.metadata || {},
    }));
  }

  // ========== TOOL EXECUTIONS ==========

  /**
   * Сохранить результат выполнения инструмента
   */
  async saveToolExecution(sessionId: string, result: ToolResult): Promise<void> {
    await q(
      `INSERT INTO tool_executions 
       (namespace, session_id, tool_name, parameters, result, success, error, duration_ms, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        this.namespace,
        sessionId,
        result.tool_name,
        JSON.stringify(result.parameters),
        JSON.stringify(result.result),
        result.success,
        result.error || null,
        result.duration_ms,
        result.timestamp,
      ]
    );
  }

  /**
   * Получить историю использования инструмента
   */
  async getToolHistory(toolName: string, limit = 20): Promise<ToolResult[]> {
    const rows = await q<any>(
      `SELECT 
        tool_name, 
        parameters, 
        result, 
        success, 
        error, 
        duration_ms, 
        timestamp
       FROM tool_executions
       WHERE namespace = $1 AND tool_name = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
      [this.namespace, toolName, limit]
    );

    return rows.map((r: any) => ({
      tool_name: r.tool_name,
      parameters: r.parameters || {},
      result: r.result,
      success: r.success,
      error: r.error || undefined,
      duration_ms: r.duration_ms,
      timestamp: new Date(r.timestamp),
    }));
  }

  // ========== CLEANUP ==========

  /**
   * Очистить старые эпизоды (старше N дней)
   */
  async cleanupOldEpisodes(daysOld = 90): Promise<number> {
    const rows = await q<{ count: number }>(
      `DELETE FROM episodic_memory
       WHERE namespace = $1 
         AND timestamp < NOW() - INTERVAL '${daysOld} days'
       RETURNING id`,
      [this.namespace]
    );
    return rows.length;
  }

  /**
   * Очистить неиспользуемые знания (low confidence + не использовались давно)
   */
  async cleanupUnusedKnowledge(maxDaysUnused = 180, minConfidence = 0.2): Promise<number> {
    const rows = await q<{ count: number }>(
      `DELETE FROM semantic_memory
       WHERE namespace = $1 
         AND confidence < $2
         AND (last_used < NOW() - INTERVAL '${maxDaysUnused} days' OR last_used IS NULL)
       RETURNING id`,
      [this.namespace, minConfidence]
    );
    return rows.length;
  }
}
