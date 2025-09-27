// apps/web/src/lib/ingest_upsert.ts
import { pool } from "@/lib/pg";
import crypto from "crypto";

export type IngestChunk = {
  content: string;
  chunk_no: number;
  metadata: Record<string, any>;
};

export type IngestDoc = {
  ns: string;
  slot: "staging" | "prod" | (string & {});
  source_id: string | null;
  url: string | null;
  title: string | null;
  published_at: string | null;
  source_type: string | null;
  kind: string | null;
  doc_metadata: Record<string, any>;
  chunks: IngestChunk[];
};

export type UpsertResult = { inserted: number; updated: number };
export type UpsertTargetsResult = UpsertResult & {
  targets: Array<{ id: string; content: string }>;
  unchanged: number; // НОВОЕ: сколько столкнулись, но контент не изменился
};

function sha1(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function makeSnippet(text: string, max = 480): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, max);
}

/** Прежний upsert без таргетов — оставляем для совместимости */
export async function upsertChunks(docs: IngestDoc[]): Promise<UpsertResult> {
  if (!Array.isArray(docs) || docs.length === 0) return { inserted: 0, updated: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0, updated = 0;

    const textInsert = `
      INSERT INTO chunks (
        ns, slot, content, url, title, snippet, published_at,
        source_type, kind, metadata, content_hash, source_id, chunk_no, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, NOW(), NOW()
      )
      ON CONFLICT (ns, slot, source_id, chunk_no) DO UPDATE SET
        content      = EXCLUDED.content,
        url          = EXCLUDED.url,
        title        = EXCLUDED.title,
        snippet      = EXCLUDED.snippet,
        published_at = EXCLUDED.published_at,
        source_type  = EXCLUDED.source_type,
        kind         = EXCLUDED.kind,
        metadata     = EXCLUDED.metadata,
        content_hash = EXCLUDED.content_hash,
        updated_at   = NOW()
      RETURNING xmax = 0 AS inserted
    `;

    for (const d of docs) {
      const ns = d.ns, slot = d.slot, docMeta = d.doc_metadata ?? {};
      for (const ch of d.chunks) {
        const content = String(ch.content ?? ""); if (!content) continue;
        const rowMeta = { ...(ch.metadata ?? {}), doc: docMeta };
        const snippet = makeSnippet(content);
        const hash = sha1(content);

        const params = [ns, slot, content, d.url ?? null, d.title ?? null, snippet,
                        d.published_at ?? null, d.source_type ?? null, d.kind ?? null,
                        rowMeta, hash, d.source_id ?? null, ch.chunk_no];

        const res = await client.query<{ inserted: boolean }>(textInsert, params);
        if (res.rows[0]?.inserted) inserted += 1; else updated += 1;
      }
    }
    await client.query("COMMIT");
    return { inserted, updated };
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
}

/**
 * Новый upsert с таргетами и подсчётом unchanged.
 * Логика:
 *  • Если запись с ключом (ns,slot,source_id,chunk_no) есть и content_hash совпадает → считаем как unchanged и пропускаем.
 *  • Иначе INSERT ... ON CONFLICT ... DO UPDATE (только при смене hash) с RETURNING — для целей эмбеддинга.
 */
export async function upsertChunksWithTargets(docs: IngestDoc[]): Promise<UpsertTargetsResult> {
  if (!Array.isArray(docs) || docs.length === 0) return { inserted: 0, updated: 0, targets: [], unchanged: 0 };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0, updated = 0, unchanged = 0;
    const targets: Array<{ id: string; content: string }> = [];

    const textSelectExisting = `
      SELECT id, content_hash
      FROM chunks
      WHERE ns = $1 AND slot = $2 AND source_id IS NOT DISTINCT FROM $3 AND chunk_no = $4
      LIMIT 1
    `;

    const textInsertReturn = `
      WITH up AS (
        INSERT INTO chunks (
          ns, slot, content, url, title, snippet, published_at,
          source_type, kind, metadata, content_hash, source_id, chunk_no, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, NOW(), NOW()
        )
        ON CONFLICT (ns, slot, source_id, chunk_no) DO UPDATE SET
          content      = EXCLUDED.content,
          url          = EXCLUDED.url,
          title        = EXCLUDED.title,
          snippet      = EXCLUDED.snippet,
          published_at = EXCLUDED.published_at,
          source_type  = EXCLUDED.source_type,
          kind         = EXCLUDED.kind,
          metadata     = EXCLUDED.metadata,
          content_hash = EXCLUDED.content_hash,
          updated_at   = NOW()
        WHERE chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash
        RETURNING id, xmax = 0 AS inserted, content AS new_content
      )
      SELECT id, inserted, new_content FROM up
    `;

    for (const d of docs) {
      const ns = d.ns, slot = d.slot, docMeta = d.doc_metadata ?? {};

      for (const ch of d.chunks) {
        const content = String(ch.content ?? ""); if (!content) continue;
        const rowMeta = { ...(ch.metadata ?? {}), doc: docMeta };
        const snippet = makeSnippet(content);
        const hash = sha1(content);

        // 1) Быстрый чек: есть ли запись и совпадает ли hash → unchanged
        const existing = await client.query<{ id: string; content_hash: string }>(textSelectExisting, [
          ns, slot, d.source_id ?? null, ch.chunk_no
        ]);
        if (existing.rows.length && existing.rows[0].content_hash === hash) {
          unchanged += 1;
          continue; // ничего не делаем
        }

        // 2) Иначе — вставка/апдейт с возвратом целей
        const params = [ns, slot, content, d.url ?? null, d.title ?? null, snippet,
                        d.published_at ?? null, d.source_type ?? null, d.kind ?? null,
                        rowMeta, hash, d.source_id ?? null, ch.chunk_no];

        const res = await client.query<{ id: string; inserted: boolean; new_content: string }>(textInsertReturn, params);

        // в rows — только новые либо реально обновлённые
        for (const row of res.rows) {
          if (row.inserted) inserted += 1; else updated += 1;
          targets.push({ id: row.id, content: row.new_content });
        }
      }
    }

    await client.query("COMMIT");
    return { inserted, updated, targets, unchanged };
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally { client.release(); }
}
