// apps/web/src/app/api/memory/search/route.ts
import { NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = (body?.query ?? "").toString().trim();

    const limitRaw = Number(body?.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, limitRaw) : 5;

    if (!query) {
      return Response.json({ error: "Provide 'query' as non-empty string" }, { status: 400 });
    }

    // 1) эмбеддинг текста запроса
    const vec = await getEmbedding(query);

    // 2) ПАРАМЕТРИЗОВАННЫЙ запрос: $1::vector — никакого ручного кавычения
    const sql = `
      SELECT
        id,
        kind,
        created_at,
        (embedding <-> $1::vector)::float AS distance
      FROM memories
      ORDER BY embedding <-> $1::vector
      LIMIT $2
    `;

    // Значение для $1 — строка в формате pgvector: [v1,v2,...] без кавычек
    const vecParam = `[${vec.join(",")}]`;
    const { rows } = await pool.query(sql, [vecParam, limit]);

    return Response.json({ items: rows }, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
