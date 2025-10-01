// apps/web/src/lib/embeddings.ts
import OpenAI from "openai";

// Lazy initialization to avoid build-time initialization errors
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Please configure it in .env.local");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

const MODEL = process.env.EMBED_MODEL || "text-embedding-3-small"; // 1536
const DIMS = Number(process.env.EMBED_DIMS || 1536);

// Грубая оценка токенов (≈4 символа на токен)
function estimateTokens(s: string) {
  return Math.ceil((s?.length || 0) / 4);
}

// Жёсткие лимиты (чуть ниже серверных, с запасом)
const MAX_TOKENS_PER_REQ = 280_000; // суммарно на batch
const MAX_ITEMS_PER_REQ = 96; // ограничим количество инпутов
const MAX_ITEM_TOKENS = 8_000; // per-input лимит модели (safe)

// Утилита: привести вектор к строковому литералу для pgvector: "[0.1,-0.2,...]"
export function toVectorLiteral(vec: number[] | { embedding: number[] }): string {
  const arr = Array.isArray(vec)
    ? vec
    : Array.isArray((vec as any)?.embedding)
    ? (vec as any).embedding
    : [];
  if (!arr.length) throw new Error("Empty embedding vector");
  return `[${arr.map((x: any) => Number(x)).join(",")}]`;
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!texts?.length) return [];

  // Разбиваем вход на батчи по сумме токенов и количеству элементов
  const batches: string[][] = [];
  let cur: string[] = [];
  let curTok = 0;

  const pushBatch = () => {
    if (cur.length) {
      batches.push(cur);
      cur = [];
      curTok = 0;
    }
  };

  for (const t of texts) {
    const tt = estimateTokens(t);
    if (tt > MAX_ITEM_TOKENS) {
      // отрежем очень длинные куски (защитный механизм)
      const safe = t.slice(0, MAX_ITEM_TOKENS * 4);
      cur.push(safe);
      curTok += Math.min(tt, MAX_ITEM_TOKENS);
    } else {
      cur.push(t);
      curTok += tt;
    }
    if (cur.length >= MAX_ITEMS_PER_REQ || curTok >= MAX_TOKENS_PER_REQ) {
      pushBatch();
    }
  }
  pushBatch();

  const out: number[][] = [];
  for (const b of batches) {
    const res = await getClient().embeddings.create({ model: MODEL, input: b });
    for (const row of res.data) {
      const v = row.embedding as unknown as number[];
      if (!Array.isArray(v)) {
        throw new Error("Embedding provider returned a non-array vector");
      }
      if (v.length !== DIMS) {
        throw new Error(`Embedding dims mismatch: got ${v.length}, expected ${DIMS}`);
      }
      out.push(v.map((x) => Number(x)));
    }
  }
  return out;
}

// Старое имя-синоним (несколько мест импортируют именно getEmbedding)
export async function getEmbedding(text: string): Promise<number[]> {
  const [v] = await embedMany([text]);
  return v;
}

// Оставляем для обратной совместимости (используется в некоторых местах)
export async function embedQuery(text: string): Promise<number[]> {
  return getEmbedding(text);
}
