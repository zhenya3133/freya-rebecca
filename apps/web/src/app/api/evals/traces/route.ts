// apps/web/src/app/api/evals/traces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/evals/traces
 * Требует X-Admin-Key == process.env.ADMIN_KEY
 * Query:
 *   ns (required)
 *   limit (1..200, default 20)
 *   offset (>=0, default 0)
 *   order = asc|desc (default desc)
 *   ok = 1|0 (опционально)
 *   profile (contains, ILIKE)
 *   model   (contains, ILIKE)
 *   q       (поиск по query/answer/error, ILIKE)
 *   from,to (ISO дата/время; фильтр по created_at)
 */
export async function GET(req: NextRequest) {
  try {
    // --- auth ---
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const ns = url.searchParams.get("ns")?.trim();
    if (!ns) {
      return NextResponse.json({ ok: false, error: "query param 'ns' is required" }, { status: 400 });
    }

    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "20"), 200));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const order = (url.searchParams.get("order") === "asc" ? "asc" : "desc") as "asc" | "desc";

    const okParam = url.searchParams.get("ok"); // "1" | "0" | null
    const profile = url.searchParams.get("profile")?.trim() || null;
    const model   = url.searchParams.get("model")?.trim() || null;
    const qtext   = url.searchParams.get("q")?.trim() || null;

    const fromStr = url.searchParams.get("from")?.trim() || null;
    const toStr   = url.searchParams.get("to")?.trim() || null;
    const from = fromStr ? new Date(fromStr) : null;
    const to   = toStr   ? new Date(toStr)   : null;

    // --- WHERE ---
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    where.push(`ns = $${i++}`); params.push(ns);

    if (okParam === "1" || okParam === "0") {
      where.push(`ok = $${i++}`); params.push(okParam === "1");
    }
    if (profile) {
      where.push(`(profile ILIKE $${i++})`); params.push(`%${profile}%`);
    }
    if (model) {
      where.push(`(model ILIKE $${i++})`); params.push(`%${model}%`);
    }
    if (qtext) {
      where.push(`(query ILIKE $${i} OR answer ILIKE $${i} OR error ILIKE $${i})`);
      params.push(`%${qtext}%`); i++;
    }
    if (from && !isNaN(from.getTime())) { where.push(`created_at >= $${i++}`); params.push(from.toISOString()); }
    if (to   && !isNaN(to.getTime()))   { where.push(`created_at <= $${i++}`); params.push(to.toISOString()); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // --- total ---
    const totalRows = await q<any>(`SELECT COUNT(*) AS n FROM eval_traces ${whereSql}`, params);
    const total = Number(totalRows?.[0]?.n || 0);

    // --- page ---
    const rows = await q<any>(
      `
      SELECT
        id, ns, query, profile, model, ok, error, latency_ms, created_at,
        CASE
          WHEN answer IS NULL THEN NULL
          ELSE substr(answer, 1, 240)
        END AS answer_preview
      FROM eval_traces
      ${whereSql}
      ORDER BY created_at ${order}
      LIMIT $${i++} OFFSET $${i++}
      `,
      [...params, limit, offset]
    );

    return NextResponse.json({
      ok: true,
      ns,
      total,
      limit,
      offset,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
      items: rows,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "traces failed" }, { status: 500 });
  }
}
