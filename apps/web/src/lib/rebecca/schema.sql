-- Rebecca Memory System: три вида памяти
-- Запускать после основной миграции БД

-- ===== EPISODIC MEMORY (эпизодическая память) =====
CREATE TABLE IF NOT EXISTS episodic_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace VARCHAR(100) NOT NULL DEFAULT 'rebecca',
  event_type VARCHAR(50) NOT NULL, -- 'task_completed', 'task_failed', 'tool_used', 'user_interaction', 'learning'
  goal TEXT NOT NULL,
  outcome VARCHAR(20) NOT NULL, -- 'success', 'failure', 'partial'
  steps_taken JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),  -- OpenAI ada-002 embeddings
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodic_namespace ON episodic_memory(namespace);
CREATE INDEX IF NOT EXISTS idx_episodic_timestamp ON episodic_memory(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_episodic_event_type ON episodic_memory(event_type);
CREATE INDEX IF NOT EXISTS idx_episodic_outcome ON episodic_memory(outcome);
CREATE INDEX IF NOT EXISTS idx_episodic_embedding ON episodic_memory USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

-- ===== SEMANTIC MEMORY (семантическая память - факты, знания) =====
CREATE TABLE IF NOT EXISTS semantic_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace VARCHAR(100) NOT NULL DEFAULT 'rebecca',
  kind VARCHAR(50) NOT NULL, -- 'fact', 'skill', 'pattern', 'knowledge', 'guideline'
  content TEXT NOT NULL,
  confidence FLOAT NOT NULL DEFAULT 0.5, -- 0.0 to 1.0
  source VARCHAR(20) NOT NULL, -- 'learned', 'provided', 'inferred'
  uses_count INTEGER NOT NULL DEFAULT 0,
  last_used TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_semantic_namespace ON semantic_memory(namespace);
CREATE INDEX IF NOT EXISTS idx_semantic_kind ON semantic_memory(kind);
CREATE INDEX IF NOT EXISTS idx_semantic_confidence ON semantic_memory(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_uses_count ON semantic_memory(uses_count DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_last_used ON semantic_memory(last_used DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_embedding ON semantic_memory USING ivfflat (embedding vector_l2_ops) WITH (lists = 100);

-- ===== TOOL EXECUTION HISTORY (история использования инструментов) =====
CREATE TABLE IF NOT EXISTS tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace VARCHAR(100) NOT NULL DEFAULT 'rebecca',
  session_id VARCHAR(100),
  tool_name VARCHAR(100) NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  success BOOLEAN NOT NULL,
  error TEXT,
  duration_ms INTEGER NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_exec_namespace ON tool_executions(namespace);
CREATE INDEX IF NOT EXISTS idx_tool_exec_session ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_exec_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_exec_timestamp ON tool_executions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tool_exec_success ON tool_executions(success);

-- ===== REFLECTIONS (рефлексия после выполнения задач) =====
CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace VARCHAR(100) NOT NULL DEFAULT 'rebecca',
  task_id VARCHAR(100) NOT NULL,
  goal TEXT NOT NULL,
  what_worked JSONB NOT NULL DEFAULT '[]'::jsonb,
  what_failed JSONB NOT NULL DEFAULT '[]'::jsonb,
  lessons_learned JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_before FLOAT NOT NULL,
  confidence_after FLOAT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reflections_namespace ON reflections(namespace);
CREATE INDEX IF NOT EXISTS idx_reflections_task_id ON reflections(task_id);
CREATE INDEX IF NOT EXISTS idx_reflections_timestamp ON reflections(timestamp DESC);

-- ===== AGENT SESSIONS (сессии выполнения агента) =====
CREATE TABLE IF NOT EXISTS agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) UNIQUE NOT NULL,
  namespace VARCHAR(100) NOT NULL DEFAULT 'rebecca',
  goal TEXT NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'active', 'completed', 'failed', 'abandoned'
  plan JSONB,
  final_output JSONB,
  duration_ms INTEGER,
  tokens_used INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON agent_sessions(namespace);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON agent_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON agent_sessions(started_at DESC);

-- Триггер для автообновления updated_at в semantic_memory
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_semantic_memory_updated_at BEFORE UPDATE ON semantic_memory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Комментарии для документации
COMMENT ON TABLE episodic_memory IS 'Эпизодическая память: что произошло, когда и как (события и опыт)';
COMMENT ON TABLE semantic_memory IS 'Семантическая память: факты, знания, паттерны (долгосрочные знания)';
COMMENT ON TABLE tool_executions IS 'История использования инструментов агентом';
COMMENT ON TABLE reflections IS 'Рефлексия агента после выполнения задач для обучения';
COMMENT ON TABLE agent_sessions IS 'Сессии выполнения агента с планами и результатами';
