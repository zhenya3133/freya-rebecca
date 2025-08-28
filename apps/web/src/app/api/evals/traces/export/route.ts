// apps/web/src/app/api/evals/traces/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // auth: X-Admin-Key ИЛИ ?adminKey=...
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const headerKey = req.headers.get("x-admin-key")?.trim();
    const queryKey = url.searchParams.get("adminKey")?.trim();
    if ((headerKey ?? queryKey) !== expect) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const ns = url.searchParams.get("ns")?.trim();
    if (!ns) return NextResponse.json({ ok: false, error: "query param 'ns' is required" }, { status: 400 });

    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "5000"), 50000));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const order = (url.searchParams.get("order") === "asc" ? "asc" : "desc") as "asc" | "desc";

    const okParam = url.searchParams.get("ok"); // "1" | "0" | null
    const profile = url.searchParams.get("profile")?.trim() || null;
    const model   = url.searchParams.get("model")?.trim()   || null;
    const qtext   = url.searchParams.get("q")?.trim()       || null;

    const fromStr = url.searchParams.get("from")?.trim() || null;
    const toStr   = url.searchParams.get("to")?.trim()   || null;
    const from = fromStr ? new Date(fromStr) : null;
    const to   = toStr   ? new Date(toStr)   : null;

    // WHERE
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    where.push(`ns = $${i++}`); params.push(ns);
    if (okParam === "1" || okParam === "0") { where.push(`ok = $${i++}`); params.push(okParam === "1"); }
    if (profile) { where.push(`profile ILIKE $${i++}`); params.push(`%${profile}%`); }
    if (model)   { where.push(`model ILIKE $${i++}`);   params.push(`%${model}%`); }
    if (qtext)   {
      where.push(`(query ILIKE $${i} OR answer ILIKE $${i} OR error ILIKE $${i})`);
      params.push(`%${qtext}%`); i++;
    }
    if (from && !isNaN(from.getTime())) { where.push(`created_at >= $${i++}`); params.push(from.toISOString()); }
    if (to   && !isNaN(to.getTime()))   { where.push(`created_at <= $${i++}`); params.push(to.toISOString()); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await q<any>(
      `
      SELECT id, ns, created_at, ok, latency_ms, profile, model,
             query, answer, error, sources, matches
      FROM eval_traces
      ${whereSql}
      ORDER BY created_at ${order}
      LIMIT $${i++} OFFSET $${i++}
      `,
      [...params, limit, offset]
    );

    const header = [
      "id","ns","created_at","ok","latency_ms","profile","model",
      "query","answer","error","sources","matches"
    ].join(",");

    const lines = rows.map((r: any) => {
      const cols = [
        r.id,
        r.ns,
        r.created_at,
        r.ok,
        r.latency_ms,
        r.profile ?? "",
        r.model ?? "",
        r.query ?? "",
        r.answer ?? "",
        r.error ?? "",
        r.sources ? JSON.stringify(r.sources) : "",
        r.matches ? JSON.stringify(r.matches) : "",
      ];
      return cols.map(csvEscape).join(",");
    });

    const csv = [header, ...lines].join("\r\n");
    const filename = `eval_traces_${ns.replace(/[^\w.-]+/g, "_")}_${new Date().toISOString().slice(0,10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "export failed" }, { status: 500 });
  }
}
