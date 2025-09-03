// apps/web/src/lib/memories.ts
import { q, withPgRetry } from "./db";
import { embedMany } from "./embeddings";
import { randomUUID } from "crypto";

export type UpsertItem = {
  content: string;
  metadata?: any;
  id?: string; // если передадим — используем (должен быть UUID), иначе сгенерим randomUUID()
};

/**
 * Вставляет тексты в memories с эмбеддингами.
 * id теперь всегда UUID (randomUUID), чтобы соответствовать типу колонки в БД.
 */
export async function upsertMemoriesBatch(kind: string, items: UpsertItem[]): Promise<string[]> {
  if (!kind) throw new Error("kind is required");
  if (!items?.length) return [];

  const texts = items.map(i => i.content);
  const embeddings = await embedMany(texts);

  const inserted: string[] = [];
  await withPgRetry(async () => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // если id задан — считаем, что это валидный UUID; иначе генерим v4
      const id = it.id && /^[0-9a-f-]{36}$/i.test(it.id) ? it.id : randomUUID();
      const emb = embeddings[i];
      const embLiteral = `[${emb.join(",")}]`;
      const meta = it.metadata ?? {};
      await q(
        `
        INSERT INTO memories (id, kind, content, embedding, metadata, created_at)
        VALUES ($1, $2, $3, $4::vector, $5::jsonb, now())
        ON CONFLICT (id) DO UPDATE
          SET kind = EXCLUDED.kind,
              content = EXCLUDED.content,
              embedding = EXCLUDED.embedding,
              metadata = EXCLUDED.metadata
        `,
        [id, kind, it.content, embLiteral, JSON.stringify(meta)]
      );
      inserted.push(id);
    }
  });

  return inserted;
}

