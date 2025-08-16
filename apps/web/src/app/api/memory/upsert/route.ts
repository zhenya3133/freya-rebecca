// apps/web/src/app/api/memory/upsert/route.ts
import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
export const runtime = "nodejs";

type UpsertBody = {
  content: string;
  kind?: string; // "plan" | "note" ...
  metadata?: any;
  chunk?: boolean; // если true — нарежем на куски
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as UpsertBody;
    const content = String(body.content ?? "").trim();
    const kind = String(body.kind ?? "plan");
    const metadata = body.metadata ?? {};
    const doChunk = Boolean(body.chunk ?? true);

    if (!content) return json({ ok: false, error: "Empty content" }, 400);

    // простейший чанкинг: делим по пустым строкам, ограничим размер чанка
    const chunks = doChunk ? splitIntoChunks(content, 900) : [content];

    // одна транзакция на все чанки
    await pool.query("BEGIN");
    try {
      for (const ch of chunks) {
        const vec = await getEmbedding(ch);
        const sql = `
          INSERT INTO memories (initiative_id, kind, content, embedding, metadata)
          VALUES (NULL, $1, $2, $3, $4::jsonb)
        `;
        await pool.query(sql, [kind, ch, vec, JSON.stringify(metadata)]);
      }
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }

    return json({ ok: true, inserted: chunks.length });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// очень простой разрезатель на параграфы/секций с ограничением
function splitIntoChunks(text: string, maxLen: number): string[] {
  const raw = text
    .split(/\n{2,}/g) // по пустым строкам
    .map((s) => s.trim())
    .filter(Boolean);

  const res: string[] = [];
  let buf = "";
  for (const part of raw) {
    if ((buf + "\n\n" + part).length > maxLen) {
      if (buf) res.push(buf);
      buf = part;
    } else {
      buf = buf ? buf + "\n\n" + part : part;
    }
  }
  if (buf) res.push(buf);
  return res;
}
