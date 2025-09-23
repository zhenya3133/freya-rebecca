// apps/web/src/app/api/logs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

// Этот роут ТОЛЬКО под X-Admin-Key (как /api/admin/sql)

export async function GET(req: NextRequest) {
  try {
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const ns = url.searchParams.get("ns")?.trim() || null;
    const slot = url.searchParams.get("slot") === "prod" ? "prod" : (url.searchParams.get("slot") === "staging" ? "staging" : null);
    const profile = url.searchParams.get("profile")?.trim() || null;
    const onlyOk = url.searchParams.get("ok");
    const ok = onlyOk === "1" ? true : onlyOk === "0" ? false : null;

    const qtext = url.searchParams.get("q")?.trim() || null;
    const from = url.searchParams.get("from")?.trim() || null; // ISO
    const to   = url.searchParams.get("to")?.trim()   || null; // ISO
    const order = (url.searchParams.get("order") === "asc" ? "asc" : "desc") as "asc"|"desc";
    const full  = url.searchParams.get("full") === "1";

    const limit  = Math.max(1, Math.min(Number(url.searchParams.get("limit") || "50"), 200));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));

    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (ns)   { where.push(`ns = $${i++}`);   params.push(ns); }
    if (slot) { where.push(`slot = $${i++}`); params.push(slot); }
    if (profile) { where.push(`profile = $${i++}`); params.push(profile); }
    if (ok !== null) { where.push(`ok = $${i++}`); params.push(ok); }
    if (qtext) {
      where.push(`(query ilike $${i} or answer ilike $${i} or error ilike $${i})`);
      params.push(`%${qtext}%`); i++;
    }
    if (from) { where.push(`created_at >= $${i++}`); params.push(from); }
    if (to)   { where.push(`created_at <= $${i++}`); params.push(to); }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const totalRows = await q<any>(`select count(*) as n from rag_logs ${whereSql}`, params);
    const total = Number(totalRows?.[0]?.n || 0);

    const cols = full
      ? `id, created_at, ns, slot, model, profile, ok, latency_ms, query, answer, error, payload, payload_parse_error, sources, matches`
      : `id, created_at, ns, slot, model, profile, ok, latency_ms,
         left(query, 240)  as query,
         left(answer, 240) as answer,
         left(error, 240)  as error`;

    const rows = await q<any>(
      `select ${cols}
       from rag_logs
       ${whereSql}
       order by created_at ${order}
       limit $${i} offset $${i+1}`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      ok: true,
      total, limit, offset,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
      items: rows
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "logs list failed" }, { status: 500 });
  }
}
