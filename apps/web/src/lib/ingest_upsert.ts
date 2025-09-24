// apps/web/src/lib/ingest_upsert.ts
import crypto from "node:crypto";
import { pool } from "@/lib/pg";

export type IngestChunk = {
  content: string;
  chunk_no: number;
  metadata?: any;
};

export type IngestDoc = {
  ns: string;
  slot: "staging" | "prod";
  source_id: string;             // уникален для документа (например, URL, owner/repo/ref/path)
  url: string | null;            // публичная ссылка на источник
  title: string | null;          // заголовок/путь
  published_at: string | null;   // ISO или null
  source_type: string | null;    // "url" | "github" | "pdf" ...
  kind: string | null;           // произвольная детализация ("mdn", "cookbook", "arxiv" и пр.)
  doc_metadata?: any;            // метаданные уровня документа
  chunks: IngestChunk[];
};

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function upsertChunks(docs: IngestDoc[]) {
  let inserted = 0;
  let updated = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sql = `
      INSERT INTO chunks
        (ns, slot, content, url, title, published_at, source_type, kind, metadata, content_hash, source_id, chunk_no)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::jsonb, '{}'::jsonb), $10, $11, $12)
      ON CONFLICT (ns, slot, source_id, chunk_no) DO UPDATE
      SET content = EXCLUDED.content,
          url = EXCLUDED.url,
          title = EXCLUDED.title,
          published_at = EXCLUDED.published_at,
          source_type = EXCLUDED.source_type,
          kind = EXCLUDED.kind,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      RETURNING (xmax = 0) AS was_inserted
    `;

    for (const d of docs) {
      for (const ch of d.chunks) {
        const params = [
          d.ns,
          d.slot,
          ch.content,
          d.url,
          d.title,
          d.published_at,
          d.source_type,
          d.kind,
          JSON.stringify({
            ...(d.doc_metadata ?? {}),
            ...(ch.metadata ?? {}),
          }),
          sha256(ch.content),
          d.source_id,
          ch.chunk_no,
        ];

        const r = await client.query(sql, params);
        const row = r.rows?.[0] as { was_inserted?: boolean } | undefined;
        if (row?.was_inserted) inserted += 1;
        else updated += 1;
      }
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw new Error(`upsertChunks failed: ${(e as any)?.message || String(e)}`);
  } finally {
    client.release();
  }

  return { inserted, updated };
}
