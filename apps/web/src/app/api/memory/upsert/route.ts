// apps/web/src/app/api/memory/upsert/route.ts
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type Body = {
  content: string;
  kind: string;
  initiative_id?: string;
  metadata?: Record<string, any>;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    if (!body?.content || !body?.kind) {
      return Response.json({ error: "content and kind are required" }, { status: 400 });
    }

    const embedding = await embedText(body.content);
    const vec = toVectorLiteral(embedding);

    const sql = `
      INSERT INTO memories (initiative_id, kind, content, embedding, metadata)
      VALUES ($1, $2, $3, $4::vector, COALESCE($5::jsonb, '{}'::jsonb))
      RETURNING id, created_at
    `;
    const out = await pool.query(sql, [
      body.initiative_id ?? null,
      body.kind,
      body.content,
      vec,
      body.metadata ? JSON.stringify(body.metadata) : null,
    ]);

    return Response.json({ ok: true, id: out.rows[0].id, created_at: out.rows[0].created_at });
  } catch (err: any) {
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
