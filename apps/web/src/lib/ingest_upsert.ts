// apps/web/src/lib/ingest_upsert.ts
import { pool } from "@/lib/pg";
import { createHash } from "crypto";
import { embedQuery } from "@/lib/embeddings"; // одна и та же модель для query/passage — ок для cosine

export type IngestChunk = {
  content: string;
  chunk_no: number;                  // 0..N-1 (стабильная нумерация)
  metadata?: Record<string, any>;
};

export type IngestDoc = {
  ns: string;                        // например: "rebecca/army/refs"
  slot: "staging" | "prod";
  source_id: string;                 // URL | file:<sha256> | gh:<owner>/<repo>@<ref>:<path>
  url?: string | null;
  title?: string | null;
  published_at?: string | null;      // ISO или null
  source_type?: string | null;       // "url" | "pdf" | "github" | ...
  kind?: string | null;              // "doc" | "section" | ...
  chunks: IngestChunk[];
  doc_metadata?: Record<string, any>;
};

/** SHA-256 в hex от текста */
const hashText = (t: string) => createHash("sha256").update(t).digest("hex");

/** простая параллельная обёртка над embedQuery */
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

/** минимальная нормализация строк */
const sanitize = (s: unknown, max = 10_000): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\u0000/g, "").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
};

/** быстрая проверка размерности векторной колонки */
const EXPECTED_DIM = 1536; // держим в синхроне с schema: vector(1536)

export async function upsertChunks(docs: IngestDoc[]) {
  if (!docs.length) return { inserted: 0, updated: 0, total: 0 };

  // 0) валидация входа (раньше, чтобы падать до эмбеддингов)
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

  // 1) готовим плоскую вставку: фильтруем пустые/очевидный мусор
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
      // чистим контент; отбрасываем совсем мелочь (< 5 символов после trim)
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

  // 2) эмбеддинги (однотипная модель норм для cosine)
  const embeddings = await embedMany(flat.map(f => f.content));

  // 3) контрольная проверка размерности (ловим рассинхрон с vector(N))
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

    // 4) батчевой UPSERT
    const BATCH = 500;
    for (let off = 0; off < flat.length; off += BATCH) {
      const slice = flat.slice(off, off + BATCH);
      const vecs  = embeddings.slice(off, off + BATCH).map(v => `[${v.join(",")}]`);

      // 13 параметров на строку (embedding как литерал ::vector — быстрее и проще, чем массив параметров)
      const rowsSql: string[] = [];
      const params: any[] = [];
      slice.forEach((r, i) => {
        const base = i * 13;
        rowsSql.push(`(
          $${base + 1}::text,          -- ns
          $${base + 2}::text,          -- slot
          $${base + 3}::text,          -- content
          ${vecs[i]}::vector,          -- embedding
          $${base + 4}::text,          -- url
          $${base + 5}::text,          -- title
          $${base + 6}::text,          -- snippet
          $${base + 7}::timestamptz,   -- published_at
          $${base + 8}::text,          -- source_type
          $${base + 9}::text,          -- kind
          $${base +10}::jsonb,         -- metadata
          $${base +11}::text,          -- content_hash
          $${base +12}::text,          -- source_id
          $${base +13}::int            -- chunk_no
        )`);
        params.push(
          r.ns,
          r.slot,
          r.content,
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
