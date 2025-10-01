import { NextResponse } from "next/server";
import { pool, withPgRetry } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "rebecca";
    const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get("limit") ?? "5", 10)));

    const { rows: cntRows } = await withPgRetry(() =>
      pool.query(`SELECT COUNT(*)::int AS c FROM memories WHERE kind = $1`, [kind])
    );

    const { rows: samples } = await withPgRetry(() =>
      pool.query(
        `SELECT id, kind, (metadata->>'path') AS path,
                jsonb_build_object(
                  'chunk_index', COALESCE((metadata->>'chunk_index')::int, NULL),
                  'source_type', metadata->>'source_type'
                ) AS meta,
                length(content) AS len,
                to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
         FROM memories
         WHERE kind = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [kind, limit]
      )
    );

    return NextResponse.json({ ok: true, kind, count: cntRows[0]?.c ?? 0, samples });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
