// apps/web/src/app/api/diag/mem-search/route.ts
import { NextResponse } from "next/server";
import { pool, withPgRetry } from "@/lib/db";
import { embedMany } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

function inferKind(ns?: string, fallback = "rebecca") {
  if (!ns) return fallback;
  const head = ns.split("/")[0]?.trim();
  return head || fallback;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const query = body?.query ?? body?.q;
    const ns: string | undefined = body?.ns;
    const topK = Number(body?.topK ?? body?.limit ?? 5);
    const kind = String(body?.kind ?? inferKind(ns, "rebecca"));

    if (!query) {
      return NextResponse.json({ ok: false, error: "query is required" }, { status: 400 });
    }

    const [vec] = await embedMany([query]);
    const vecLit = `[${vec.join(",")}]`;

    const params: any[] = [vecLit, kind, Math.max(1, Math.min(20, topK))];
    let nsFilterSql = "";
    if (ns) {
      nsFilterSql = `
        AND (
          (metadata->>'ns') = $4
          OR (metadata->'source')::jsonb->>'ns' = $4
        )
      `;
      params.push(ns);
    }

    const sql = `
      SELECT id,
             (metadata->>'path') AS path,
             (metadata->>'ns')   AS ns,
             length(content)     AS len,
             (embedding <=> $1::vector) AS dist
      FROM memories
      WHERE kind = $2
      ${nsFilterSql}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $3
    `;

    const { rows } = await withPgRetry(() => pool.query(sql, params));

    const matches = rows.map((r: any) => ({
      id: r.id,
      path: r.path,
      ns: r.ns,
      len: Number(r.len),
      dist: Number(r.dist),
      score: 1 - Math.min(1, Number(r.dist))
    }));

    return NextResponse.json({ ok: true, kind, ns, query, topK, matches });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
