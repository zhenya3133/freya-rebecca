// apps/web/src/lib/env.ts
export const ENV = {
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  X_ADMIN_KEY: process.env.X_ADMIN_KEY ?? "",
  INGEST_ENABLED: (process.env.INGEST_ENABLED ?? "0") === "1",
  INGEST_CHANNELS: (process.env.INGEST_CHANNELS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
  PROMPT_CACHE: (process.env.PROMPT_CACHE ?? "0") === "1",
  OPENAI_TIMEOUT_MS: Number(process.env.OPENAI_TIMEOUT_MS ?? 45000),
} as const;
