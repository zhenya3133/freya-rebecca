// apps/web/src/lib/embeddings.ts
export async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    cache: "no-store",
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenAI embeddings error: ${resp.status} ${t}`);
  }
  const json = (await resp.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
