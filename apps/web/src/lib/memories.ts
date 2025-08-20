// apps/web/src/lib/memories.ts
import { q, withPgRetry } from "./../lib/db";
import { embedMany } from "./embeddings";
import { sha256Hex } from "./hash";

export type UpsertItem = {
  content: string;
  metadata?: any;
  // если не передать id, он будет детерминирован: sha256(kind|content)
  id?: string;
};

/**
 * Вставляет массив текстов в memories с эмбеддингами.
 * Детерминированный id обеспечивает идемпотентность (ON CONFLICT (id) DO UPDATE).
 */
export async function upsertMemoriesBatch(kind: string, items: UpsertItem[]): Promise<string[]> {
  if (!kind) throw new Error("kind is required");
  const texts = items.map(i => i.content);
  const embeddings = await embedMany(texts);

  const inserted: string[] = [];
  await withPgRetry(async () => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const id = it.id ?? sha256Hex(`${kind}|${it.content}`);
      const emb = embeddings[i];
      const embLiteral = `[${emb.join(",")}]`;
      const meta = it.metadata ?? {};
      await q(`
        INSERT INTO memories (id, kind, content, embedding, metadata, created_at)
        VALUES ($1,$2,$3,$4::vector,$5::jsonb, now())
        ON CONFLICT (id) DO UPDATE
          SET kind = EXCLUDED.kind,
              content = EXCLUDED.content,
              embedding = EXCLUDED.embedding,
              metadata = EXCLUDED.metadata
      `, [id, kind, it.content, embLiteral, JSON.stringify(meta)]);
      inserted.push(id);
    }
  });

  return inserted;
}
