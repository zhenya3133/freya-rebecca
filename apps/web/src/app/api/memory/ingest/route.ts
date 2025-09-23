// apps/web/src/app/api/memory/ingest/route.ts
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
export const runtime = "nodejs";

type IngestBody = {
  ns?: string;                       // пространство памяти (rebecca / floki / ...)
  kind?: string;                     // "code" | "doc" | "note" ...
  content?: string;                  // сырой текст (если нет chunks)
  chunks?: { kind?: string; text: string }[];
  chunk_size?: number;
  overlap?: number;
  metadata?: Record<string, any>;
};

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL) return err(500, "DATABASE_URL is not set");
    if (!process.env.OPENAI_API_KEY) return err(500, "OPENAI_API_KEY is not set");

    const body = (await req.json().catch(() => ({}))) as IngestBody;
    const ns   = (body.ns ?? "rebecca").trim() || "rebecca";
    const kind = (body.kind ?? "note").trim() || "note";
    const baseMeta = { ...(body.metadata ?? {}), ns };

    let pieces: { kind: string; text: string }[] = [];
    if (Array.isArray(body.chunks) && body.chunks.length) {
      pieces = body.chunks
        .filter(c => c?.text?.trim())
        .map(c => ({ kind: (c.kind ?? kind).trim() || "note", text: c.text.trim() }));
    } else {
      const text = (body.content ?? "").trim();
      if (!text) return err(400, "Provide 'content' or 'chunks[]'");
      const size = clamp(body.chunk_size ?? 1000, 200, 4000);
      const ov   = clamp(body.overlap ?? 150, 0, 1000);
      pieces = splitText(text, size, ov).map(t => ({ kind, text: t }));
    }
    if (pieces.length > 300) return err(400, "Too many chunks (max 300)");

    const ids: string[] = [];
    for (const p of pieces) {
      const emb = await getEmbedding(p.text);
      const vec = toVectorLiteral(emb);
      const sql = `
        INSERT INTO memories (id, initiative_id, kind, content, embedding, metadata)
        VALUES (gen_random_uuid(), NULL, $1, $2, $3::vector, $4::jsonb)
        RETURNING id
      `;
      const meta = JSON.stringify({ ...baseMeta, kind: p.kind });
      const { rows } = await pool.query(sql, [p.kind, p.text, vec, meta]);
      ids.push(rows[0].id);
    }

    return ok({ inserted: ids.length, ids });
  } catch (e: any) {
    return err(500, String(e?.message ?? e));
  }
}

/* utils */
function ok(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function err(status: number, message: string) {
  return ok({ error: message }, status);
}
function clamp(n: number, min: number, max: number) {
  const x = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}
function splitText(s: string, size: number, overlap: number) {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const end = Math.min(s.length, i + size);
    out.push(s.slice(i, end));
    if (end >= s.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return out;
}
