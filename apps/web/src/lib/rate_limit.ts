/**
 * src/lib/rate_limit.ts
 * Простейший token-bucket limiter на процессе (dev/standalone).
 * Для прод-кластера используйте внешний стор (Redis/Upstash/Edge).
 */
import { NextRequest } from "next/server";

type Bucket = { tokens: number; updatedAt: number };

const BUCKETS = (globalThis as any).__rl_buckets__ as Map<string, Bucket> || new Map<string, Bucket>();
(globalThis as any).__rl_buckets__ = BUCKETS;

const CAPACITY = Number(process.env.RAG_RL_CAPACITY ?? 30);   // макс. токенов
const REFILL_PS = Number(process.env.RAG_RL_REFILL_PS ?? 0.5); // пополнение в сек (0.5 ~ 30/мин)

function nowSec() { return Date.now() / 1000; }

function ipKey(req: NextRequest): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim()
    || h.get("x-real-ip")
    || "local"
  )!;
}

export function rateLimitCheck(req: NextRequest): { ok: boolean; remaining: number; resetMs: number } {
  const key = ipKey(req);
  const t = nowSec();
  let b = BUCKETS.get(key);
  if (!b) {
    b = { tokens: CAPACITY, updatedAt: t };
    BUCKETS.set(key, b);
  }
  // refill
  const elapsed = Math.max(0, t - b.updatedAt);
  b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PS);
  b.updatedAt = t;

  if (b.tokens < 1) {
    const deficit = 1 - b.tokens;
    const wait = Math.ceil((deficit / REFILL_PS) * 1000);
    return { ok: false, remaining: 0, resetMs: wait };
  }
  b.tokens -= 1;
  return { ok: true, remaining: Math.floor(b.tokens), resetMs: 0 };
}
