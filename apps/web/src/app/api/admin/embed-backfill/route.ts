// apps/web/src/app/api/admin/embed-backfill/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { embedMany } from "@/lib/embeddings";
import { assertAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns?: string | null;
  slot?: string | null;
  limit?: number;      // default 200
  batchSize?: number;  // default 16
};

// Преобразуем массив чисел в литерал для pgvector: [0.1,0.2,...]
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function POST(req: NextRequest) {
  try {
    // единая проверка ключа: ADMIN_KEY + заголовок x-admin-key
    assertAdmin(req);

    const body = (await req.json().catch(() => ({}))) as Body;
    const ns = (body.ns || "").trim();
    const slot = (body.slot || "").trim();
    const limit = Number.isFinite(body.limit) ? Math.max(1, Number(body.limit)) : 200;
    const batchSize = Number.isFinite(body.batchSize) ? Math.max(1, Number(body.batchSize)) : 16;

    // Собираем WHERE + параметры для pool.query
    let where = "WHERE embedding IS NULL";
    const params: any[] = [];
    if (ns) {
      params.push(ns);
      where += ` AND ns = $${params.length}`;
    }
    if (slot) {
      params.push(slot);
      where += ` AND slot = $${params.length}`;
    }

    let processed = 0;
    const startedAt = Date.now();

    while (processed < limit) {
      const take = Math.min(batchSize, limit - processed);

      // SELECT c параметром LIMIT как $N
      const selectParams = params.slice(); // копия
      selectParams.push(take);
      const selectSql = `
        SELECT id, content
        FROM chunks
        ${where}
        ORDER BY id
        LIMIT $${selectParams.length}
      `;
      const sel = await pool.query<{ id: string; content: string }>(selectSql, selectParams);
      const rows = sel.rows;
      if (!rows.length) break;

      // Эмбеддинги: ДОЛЖНЫ быть длины, соответствующей типу vector(N) в БД (у тебя N=383)
      const texts = rows.map(r => String(r.content ?? ""));
      const vectors = await embedMany(texts); // number[][]

      // Обновляем по одному (каст к ::vector проверит размерность)
      for (let i = 0; i < rows.length; i++) {
        const id = rows[i].id;
        const vec = vectors[i];
        const vecLit = toVectorLiteral(vec);
        await pool.query(
          `UPDATE chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`,
          [vecLit, id]
        );
        processed += 1;
        if (processed >= limit) break;
      }
    }

    const tookMs = Date.now() - startedAt;
    return NextResponse.json({ ok: true, processed, tookMs });
  } catch (err: any) {
    const msg = err?.message || String(err);
    const code = msg === "unauthorized" ? 401 : (msg === "ADMIN_KEY is not set" ? 500 : 500);
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
