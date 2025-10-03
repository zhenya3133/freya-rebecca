/**
 * Rebecca - AI Agent Architecture
 * Три вида памяти + Planning + Tool Use + Reflection
 */

// ========== MEMORY TYPES ==========

/**
 * 1. Working Memory - краткосрочная память для текущей задачи
 * Хранится в RAM, живёт только во время выполнения задачи
 */
export interface WorkingMemory {
  goal: string;                    // текущая цель
  plan: string[];                  // план действий (steps)
  currentStep: number;             // текущий шаг
  context: Record<string, any>;    // временные данные
  scratchpad: string[];            // промежуточные мысли/вычисления
  toolResults: ToolResult[];       // результаты использования инструментов
}

/**
 * 2. Episodic Memory - эпизодическая память (что произошло, когда, как)
 * Хранится в БД, индексируется по времени
 */
export interface EpisodicMemory {
  id: string;
  timestamp: Date;
  event_type: 'task_completed' | 'task_failed' | 'tool_used' | 'user_interaction' | 'learning';
  goal: string;
  outcome: 'success' | 'failure' | 'partial';
  steps_taken: string[];
  duration_ms: number;
  metadata: Record<string, any>;
  embedding?: number[];            // для семантического поиска
}

/**
 * 3. Semantic Memory - семантическая память (факты, знания, паттерны)
 * Хранится в БД с vector embeddings
 */
export interface SemanticMemory {
  id: string;
  kind: 'fact' | 'skill' | 'pattern' | 'knowledge' | 'guideline';
  content: string;
  confidence: number;              // 0-1, насколько уверены в этом знании
  source: 'learned' | 'provided' | 'inferred';
  uses_count: number;              // сколько раз использовали
  last_used: Date;
  embedding: number[];
  metadata: Record<string, any>;
}

// ========== PLANNING ==========

export interface Plan {
  goal: string;
  steps: PlanStep[];
  estimated_complexity: 'simple' | 'moderate' | 'complex';
  confidence: number;
}

export interface PlanStep {
  id: string;
  description: string;
  dependencies: string[];          // IDs шагов, от которых зависит
  tool?: string;                   // какой инструмент использовать
  expected_output?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

// ========== TOOL USE ==========

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  returns: string;
  examples?: ToolExample[];
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
}

export interface ToolExample {
  input: Record<string, any>;
  output: any;
  explanation: string;
}

export interface ToolCall {
  tool_name: string;
  parameters: Record<string, any>;
  reasoning?: string;              // почему вызвали этот инструмент
}

export interface ToolResult {
  tool_name: string;
  parameters: Record<string, any>;
  result: any;
  success: boolean;
  error?: string;
  duration_ms: number;
  timestamp: Date;
}

// ========== REFLECTION & LEARNING ==========

export interface Reflection {
  task_id: string;
  timestamp: Date;
  what_worked: string[];
  what_failed: string[];
  lessons_learned: string[];
  suggestions: string[];
  confidence_before: number;
  confidence_after: number;
}

// ========== AGENT STATE ==========

export interface AgentState {
  session_id: string;
  working_memory: WorkingMemory;
  current_reflection?: Reflection;
  agent_metadata: {
    name: string;
    version: string;
    capabilities: string[];
    available_tools: string[];
  };
}

// ========== EXECUTION RESULT ==========

export interface ExecutionResult {
  success: boolean;
  goal: string;
  plan: Plan;
  steps_completed: PlanStep[];
  final_output: any;
  reflections: Reflection;
  working_memory_snapshot: WorkingMemory;
  duration_ms: number;
  tokens_used?: number;
  error?: string;
}
