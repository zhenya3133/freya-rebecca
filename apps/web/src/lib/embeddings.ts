// apps/web/src/lib/embeddings.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small"; // 1536-dim

function trimToLimit(s: string, max = 8192) {
  return s.length > max ? s.slice(0, max) : s;
}

/** Эмбеддинг одной строки */
export async function embedOne(text: string): Promise<number[]> {
  const res = await client.embeddings.create({ model: MODEL, input: trimToLimit(text) });
  return res.data[0].embedding as number[];
}

/** Эмбеддинг массива строк пачками (до 100 за раз) */
export async function embedMany(texts: string[], batchSize = 64): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map(t => trimToLimit(t));
    const res = await client.embeddings.create({ model: MODEL, input: batch });
    for (const item of res.data) out.push(item.embedding as number[]);
  }
  return out;
}
