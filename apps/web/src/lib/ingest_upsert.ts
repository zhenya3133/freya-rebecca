// apps/web/src/lib/ingest_upsert.ts
import { pool } from "@/lib/pg";
import { createHash } from "crypto";
import { embedQuery } from "@/lib/embeddings";

export type IngestChunk = {
  content: string;
  chunk_no: number;
  metadata?: Record<string, any>;
};

export type IngestDoc = {
  ns: string;
  slot: "staging" | "prod";
  source_id: string;
  url?: string | null;
  title?: string | null;
  published_at?: string | null;
  source_type?: string | null;
  kind?: string | null;
  chunks: IngestChunk[];
  doc_metadata?: Record<string, any>;
};

const hashText = (t: string) => createHash("sha256").update(t).digest("hex");

async function embedMany(texts: string[], concurrency = 8): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let i = 0;
  const worker = async () => {
    while (true) {
      const idx = i++;
      if (idx >= texts.length) break;
      out[idx] = await embedQuery(texts[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
  return out;
}

const sanitize = (s: unknown, max = 10_000): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\u0000/g, "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
};

const EXPECTED_DIM = 1536;

export async function upsertChunks(docs: IngestDoc[]) {
  if (!docs.length) return { inserted: 0, updated: 0, total: 0 };

  for (const d of docs) {
    if (!d.ns?.trim()) throw new Error("upsertChunks: ns is required");
    if (d.slot !== "staging" && d.slot !== "prod") {
      throw new Error(`upsertChunks: slot must be 'staging'|'prod', got '${d.slot}'`);
    }
    if (!d.source_id?.trim()) throw new Error("upsertChunks: source_id is required");
    if (!Array.isArray(d.chunks) || d.chunks.length === 0) {
      throw new Error(`upsertChunks: empty chunks for source_id=${d.source_id}`);
    }
  }

  const flat: Array<{
    ns: string;
    slot: "staging" | "prod";
    content: string;
    url: string | null;
    title: string | null;
    snippet: string | null;
    published_at: string | null;
    source_type: string | null;
    kind: string | null;
    metadata: Record<string, any>;
    content_hash: string;
    source_id: string;
    chunk_no: number;
  }> = [];

  for (const d of docs) {
    const commonMeta = d.doc_metadata || {};
    for (const ch of d.chunks) {
      const content = sanitize(ch.content, 50_000);
      if (!content || content.length < 5) continue;

      const snippet = content.slice(0, 300);
      flat.push({
        ns: d.ns.trim(),
        slot: d.slot,
        content,
        url: sanitize(d.url || null, 2048),
        title: sanitize(d.title || null, 512),
        snippet,
        published_at: d.published_at || null,
        source_type: d.source_type || null,
        kind: d.kind || null,
        metadata: { ...commonMeta, ...(ch.metadata || {}) },
        content_hash: hashText(content),
        source_id: d.source_id,
        chunk_no: ch.chunk_no,
      });
    }
  }

  if (!flat.length) return { inserted: 0, updated: 0, total: 0 };

  const embeddings = await embedMany(flat.map(f => f.content));

  if (embeddings.length !== flat.length) {
    throw new Error(`upsertChunks: embeddings count mismatch: got ${embeddings.length}, expected ${flat.length}`);
  }
  const firstBad = embeddings.findIndex(v => !Array.isArray(v) || v.length !== EXPECTED_DIM);
  if (firstBad >= 0) {
    throw new Error(`upsertChunks: embedding dim != ${EXPECTED_DIM} at index ${firstBad} (len=${embeddings[firstBad]?.length})`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 0");
    await client.query("SET LOCAL application_name = 'ingest_upsert'");

    let inserted = 0, updated = 0;

    const BATCH = 500;
    for (let off = 0; off < flat.length; off += BATCH) {
      const slice = flat.slice(off, off + BATCH);
      const vecs  = embeddings.slice(off, off + BATCH);

      const rowsSql: string[] = [];
      const params: any[] = [];
      slice.forEach((r, i) => {
        const base = i * 14;
        rowsSql.push(`(
          $${base + 1}::text,
          $${base + 2}::text,
          $${base + 3}::text,
          $${base + 4}::vector,
          $${base + 5}::text,
          $${base + 6}::text,
          $${base + 7}::text,
          $${base + 8}::timestamptz,
          $${base + 9}::text,
          $${base +10}::text,
          $${base +11}::jsonb,
          $${base +12}::text,
          $${base +13}::text,
          $${base +14}::int
        )`);
        params.push(
          r.ns,
          r.slot,
          r.content,
          `[${vecs[i].join(",")}]`, // Pass embedding as a string representation of a vector
          r.url,
          r.title,
          r.snippet,
          r.published_at,
          r.source_type,
          r.kind,
          JSON.stringify(r.metadata ?? {}),
          r.content_hash,
          r.source_id,
          r.chunk_no,
        );
      });

      const sql = `
        INSERT INTO chunks
          (ns, slot, content, embedding, url, title, snippet, published_at,
           source_type, kind, metadata, content_hash, source_id, chunk_no)
        VALUES ${rowsSql.join(",\n")}
        ON CONFLICT (ns, slot, COALESCE(source_id,''), chunk_no)
        DO UPDATE SET
          content       = EXCLUDED.content,
          embedding     = EXCLUDED.embedding,
          url           = EXCLUDED.url,
          title         = EXCLUDED.title,
          snippet       = EXCLUDED.snippet,
          published_at  = EXCLUDED.published_at,
          source_type   = EXCLUDED.source_type,
          kind          = EXCLUDED.kind,
          metadata      = EXCLUDED.metadata,
          content_hash  = EXCLUDED.content_hash,
          updated_at    = now()
        WHERE chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash
        RETURNING (xmax = 0) AS inserted_flag;
      `;

      const res = await client.query<{ inserted_flag: boolean }>(sql, params);
      for (const row of res.rows) {
        if (row.inserted_flag) inserted++; else updated++;
      }
    }

    await client.query("COMMIT");
    return { inserted, updated, total: flat.length };
  } catch (e: any) {
    await client.query("ROLLBACK");
    const msg = e?.message || String(e);
    throw new Error(`upsertChunks failed: ${msg}`);
  } finally {
    client.release();
  }
}


