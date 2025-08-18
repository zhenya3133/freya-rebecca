// apps/web/src/app/api/memory/upsert/route.ts
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";

export const runtime = "nodejs";

type UpsertBody = {
  ns?: string;                                // неймспейс (rebecca/floki/…)
  kind?: string;                              // тип записи: "doc" | "plan" | …
  content?: string;                           // текст целиком
  metadata?: Record<string, unknown>;         // доп. поля
  chunk?: { size?: number; overlap?: number } // опции чанкинга
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return jsonErr(500, "DATABASE_URL is not set");
    }

    const body = (await req.json().catch(() => ({}))) as UpsertBody;
    const ns = (body.ns ?? "rebecca").trim() || "rebecca";
    const kind = (body.kind ?? "doc").trim() || "doc";
    const content = String(body.content ?? "");
    if (!content) return jsonErr(400, "Provide 'content' in request body");

    const chunkCfg = body.chunk ?? {};
    const parts = splitIntoChunks(content, chunkCfg);
    const metaBase = { ...(body.metadata ?? {}), ns };

    const ids: string[] = [];
    for (const part of parts) {
      const vec = await getEmbedding(part);
      const vecParam = toVectorLiteral(vec);
      const sql = `
        INSERT INTO memories (initiative_id, kind, content, embedding, metadata)
        VALUES (NULL, $1, $2, $3::vector, $4::jsonb)
        RETURNING id
      `;
      const { rows } = await pool.query(sql, [
        kind,
        part,
        vecParam,
        JSON.stringify(metaBase),
      ]);
      ids.push(rows[0].id);
    }

    return jsonOk({ ok: true, count: ids.length, ids });
  } catch (e: any) {
    console.error("memory/upsert error:", e);
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
