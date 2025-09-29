import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
export const runtime = "nodejs";

type Body = { query?: string; limit?: number; ns?: string };

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL) return jsonErr(500, "DATABASE_URL is not set");
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");

    const body = (await req.json().catch(() => ({}))) as Body;
    const query = (body.query ?? "").trim();
    const ns = (body.ns ?? "rebecca").trim() || "rebecca";
    const topK = clampInt(body.limit ?? Number(process.env.RAG_TOPK ?? 5), 1, 50);
    if (!query) return jsonErr(400, "Provide 'query'");

    const vec = await getEmbedding(query);
    const vecParam = toVectorLiteral(vec);

    const sql = `
      SELECT id, kind, content, created_at, (embedding <-> $1::vector) AS distance
      FROM memories
      WHERE metadata->>'ns' = $3
      ORDER BY distance ASC
      LIMIT $2
    `;
    const { rows } = await pool.query(sql, [vecParam, topK, ns]);

    return jsonOk({
      items: rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        distance: Number(r.distance),
        created_at: r.created_at,
      })),
    });
  } catch (e: any) {
    return jsonErr(500, String(e?.message ?? e));
  }
}
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) { return jsonOk({ error: message }, status); }
function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}
