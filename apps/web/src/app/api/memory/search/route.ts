// apps/web/src/app/api/memory/search/route.ts
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type Body = {
  query: string;
  limit?: number;
  initiative_id?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.query) {
      return Response.json({ error: "query is required" }, { status: 400 });
    }

    const limit = Math.min(Math.max(body.limit ?? 5, 1), 20);
    const vec = toVectorLiteral(await embedText(body.query));

    const sql = `
      SELECT id, initiative_id, kind, content, metadata, created_at,
             embedding <=> $1::vector AS distance
      FROM memories
      WHERE ($2::uuid IS NULL OR initiative_id = $2::uuid)
      ORDER BY distance ASC
      LIMIT $3
    `;
    const out = await pool.query(sql, [vec, body.initiative_id ?? null, limit]);
    return Response.json({ ok: true, items: out.rows });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
