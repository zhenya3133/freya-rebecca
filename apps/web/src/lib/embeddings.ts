// apps/web/src/lib/embeddings.ts
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Получаем вектор эмбеддинга */
export async function getEmbedding(text: string): Promise<number[]> {
  const input = text.replace(/\s+/g, " ").trim();
  const res = await client.embeddings.create({
    model: "text-embedding-3-small",
    input,
  });
  // у OpenAI это number[] (длина ~1536)
  return res.data[0].embedding as unknown as number[];
}

/** Превращаем массив чисел в литерал для Postgres vector: [0.1,0.2,...] */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
