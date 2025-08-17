// apps/web/src/app/api/memory/upsert/route.ts
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";

export const runtime = "nodejs";

type ChunkIn = { kind?: string; text: string };

type UpsertBody = {
  id?: string;                         // если есть — обновим существующую запись (только 1 чанк)
  ns?: string;                         // пространство памяти, по умолчанию "rebecca"
  kind?: string;                       // тип записи: "doc" | "code" | "note" ...
  content?: string;                    // сырой текст (если нет chunks)
  chunks?: ChunkIn[];                  // массив чанков для массовой вставки
  chunk_size?: number;                 // если режем content на чанки
  overlap?: number;
  metadata?: Record<string, unknown>;  // любые доп. метаданные
};

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL is not set");
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");

    const bodyRaw = await req.json().catch(() => ({}));
    const body = bodyRaw as UpsertBody;

    const ns   = (body.ns ?? "rebecca").trim() || "rebecca";
    const kind = (body.kind ?? "note").trim() || "note";

    // Подготовим массив кусочков текста для записи
    let pieces: { kind: string; text: string }[] = [];
    if (Array.isArray(body.chunks) && body.chunks.length) {
      pieces = body.chunks
        .filter((c: ChunkIn) => typeof c?.text === "string" && c.text.trim().length > 0)
        .map((c: ChunkIn) => ({ kind: (c.kind ?? kind).trim() || "note", text: c.text.trim() }));
    } else {
      const text = (body.content ?? "").trim();
      if (!text) return jsonErr(400, "Provide 'content' or non-empty 'chunks[]'");
      // если пришел один текст — нарежем
      const size = clampInt(body.chunk_size ?? 1500, 200, 4000);
      const ov   = clampInt(body.overlap ?? 200, 0, 1000);
      pieces = splitIntoChunks(text, { size, overlap: ov }).map((t) => ({ kind, text: t }));
    }

    if (!pieces.length) return jsonErr(400, "Nothing to upsert");
    if (pieces.length > 300) return jsonErr(400, "Too many chunks (max 300)");

    // Базовые метаданные: всегда пишем ns
    const baseMeta: Record<string, unknown> = {
      ...(body.metadata ?? {}),
      ns,
      source: (body.metadata as any)?.source ?? "upsert",
    };

    // Если указан id — обновим ровно одну запись (первым куском)
    if (body.id) {
      const first = pieces[0];
      const emb = await getEmbedding(first.text);
      const vec = toVectorLiteral(emb);
      const sqlUpd = `
        UPDATE memories
        SET kind = $2,
            content = $3,
            embedding = $4::vector,
            metadata = $5::jsonb
        WHERE id = $1
        RETURNING id
      `;
      const { rows } = await pool.query(sqlUpd, [
        body.id,
        first.kind,
        first.text,
        vec,
        JSON.stringify(baseMeta),
      ]);
      if (!rows || !rows[0]) return jsonErr(404, `Memory id=${body.id} not found`);
      return jsonOk({ updated: 1, id: rows[0].id });
    }

    // Иначе — вставим N записей (по количеству чанков)
    const ids: string[] = [];
    for (const p of pieces) {
      const emb = await getEmbedding(p.text);
      const vec = toVectorLiteral(emb);
      const sqlIns = `
        INSERT INTO memories (id, initiative_id, kind, content, embedding, metadata)
        VALUES (gen_random_uuid(), NULL, $1, $2, $3::vector, $4::jsonb)
        RETURNING id
      `;
      const { rows } = await pool.query(sqlIns, [
        p.kind,
        p.text,
        vec,
        JSON.stringify({ ...baseMeta, kind: p.kind }),
      ]);
      ids.push(rows[0].id);
      // небольшая пауза, чтобы не спамить API эмбеддингов
      await sleep(60);
    }

    return jsonOk({ inserted: ids.length, ids, ns });
  } catch (e: unknown) {
    const msg = (e instanceof Error) ? e.message : String(e);
    console.error("memory/upsert error:", msg);
    return jsonErr(500, msg);
  }
}

/* ---------------- utils ---------------- */
function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number.isFinite(n) ? Number(n) : min);
  return Math.max(min, Math.min(max, x));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
