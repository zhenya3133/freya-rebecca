// apps/web/src/app/api/memory/import/plain/route.ts
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";

export const runtime = "nodejs";

type Body = {
  ns?: string;
  kind?: string;
  title?: string;
  text?: string;                              // основное содержимое
  metadata?: Record<string, unknown>;
  chunk?: { size?: number; overlap?: number };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const ns = (body.ns ?? "rebecca").trim() || "rebecca";
    const kind = (body.kind ?? "doc").trim() || "doc";
    const title = (body.title ?? "").trim();
    const text = String(body.text ?? "");
    if (!text) return jsonErr(400, "Provide 'text'");

    const metaBase = { ...(body.metadata ?? {}), ns, title };
    const chunks = splitIntoChunks(text, body.chunk ?? {});

    const ids: string[] = [];
    for (const part of chunks) {
      const vec = await getEmbedding(part);
      const { rows } = await pool.query(
        `
        INSERT INTO memories (initiative_id, kind, content, embedding, metadata)
        VALUES (NULL, $1, $2, $3::vector, $4::jsonb)
        RETURNING id
        `,
        [kind, part, toVectorLiteral(vec), JSON.stringify(metaBase)]
      );
      ids.push(rows[0].id);
    }

    return jsonOk({ ok: true, count: ids.length, ids });
  } catch (e: any) {
    console.error("memory/import/plain error:", e);
    return jsonErr(500, String(e?.message ?? e));
  }
}

function jsonOk(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
