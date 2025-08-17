// apps/web/src/lib/embeddings.ts
import OpenAI from "openai";

export async function getEmbedding(text: string): Promise<number[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const res = await client.embeddings.create({
    model: process.env.EMBED_MODEL || "text-embedding-3-small",
    input: text,
  });
  // у OpenAI именно поле data[0].embedding
  return (res.data[0].embedding as unknown) as number[];
}

export function toVectorLiteral(vec: number[]): string {
  // ВАЖНО: без кавычек вокруг массива
  return `[${vec.join(",")}]`;
}
