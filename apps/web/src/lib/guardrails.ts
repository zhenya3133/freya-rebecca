/**
 * src/lib/guardrails.ts
 */
export const RAG_DEFAULTS = {
  topK: 8,
  minScore: 0.62,
  maxTokens: 700,
  promptMaxLen: 4000,
} as const;

export const RAG_LIMITS = {
  topK: { min: 1, max: 20 },
  minScore: { min: 0, max: 1 },
  maxTokens: { min: 1, max: 8192 },
} as const;

export function parseIntInRange(v: unknown, def: number, min: number, max: number) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

export function parseFloatInRange(v: unknown, def: number, min: number, max: number) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}

export function limitText(s: unknown, max = RAG_DEFAULTS.promptMaxLen): string {
  const t = String(s ?? '');
  if (t.length > max) throw new Error(`Prompt too long: ${t.length} > ${max}`);
  return t;
}

/** Разрешённый формат ns: a-z0-9._/- + обязательность */
export function assertNamespace(ns: unknown): string {
  if (typeof ns !== "string") throw new Error("Namespace is required");
  const v = ns.trim();
  if (!v || v === "undefined" || v === "null") throw new Error("Namespace is required");
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(v)) {
    throw new Error(`Invalid namespace: "${v}"`);
  }
  return v;
}

/** Универсальный разбор параметров RAG из query/body */
export function validateRagParams(input: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) =>
    input instanceof URLSearchParams ? input.get(k) : (input as any)[k];

  const topK     = parseIntInRange(get('topK'),     RAG_DEFAULTS.topK,     RAG_LIMITS.topK.min,     RAG_LIMITS.topK.max);
  const minScore = parseFloatInRange(get('minScore'), RAG_DEFAULTS.minScore, RAG_LIMITS.minScore.min, RAG_LIMITS.minScore.max);
  const maxTokens= parseIntInRange(get('maxTokens'),RAG_DEFAULTS.maxTokens, RAG_LIMITS.maxTokens.min,RAG_LIMITS.maxTokens.max);

  return { topK, minScore, maxTokens };
}

