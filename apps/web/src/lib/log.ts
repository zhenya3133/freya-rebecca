// apps/web/src/lib/log.ts
export type LogMeta = {
  route: string;
  method: string;
  requestId?: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  ms?: number;
  note?: string;
};

export function startTimer() {
  const t0 = Date.now();
  return () => Date.now() - t0;
}

export function log(meta: LogMeta) {
  const safe = {
    route: meta.route,
    method: meta.method,
    requestId: meta.requestId,
    model: meta.model,
    promptTokens: meta.promptTokens,
    completionTokens: meta.completionTokens,
    costUsd: meta.costUsd,
    ms: meta.ms,
    note: meta.note,
  };
  console.log("[LOG]", JSON.stringify(safe));
}
