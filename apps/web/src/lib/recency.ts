// apps/web/src/lib/recency.ts
export type RecencyCfg = { halfLifeDays: number; ttlDays: number; alpha: number; beta: number; gamma: number };

export const RECENCY: Record<string, RecencyCfg> = {
  "rebecca/patterns": { halfLifeDays: 180, ttlDays: 540, alpha: 0.70, beta: 0.15, gamma: 0.15 },
  "rebecca/core":     { halfLifeDays: 365, ttlDays: 9999,alpha: 0.85, beta: 0.05, gamma: 0.10 },
  "market/by":        { halfLifeDays: 30,  ttlDays: 120, alpha: 0.60, beta: 0.30, gamma: 0.10 },
  "market/ru":        { halfLifeDays: 30,  ttlDays: 120, alpha: 0.60, beta: 0.30, gamma: 0.10 },
  "sales/playbooks":  { halfLifeDays: 90,  ttlDays: 365, alpha: 0.70, beta: 0.20, gamma: 0.10 }
};

/** time-decay (0..1): 0.5^(age/halfLife) */
export function timeDecay(ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / Math.max(halfLifeDays, 1));
}
