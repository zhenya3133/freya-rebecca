import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });

    const rows = await q<any>(`
      select id, ns, query, profile, model, answer, matches, sources, ok, error, latency_ms, meta, created_at
      from eval_traces where id = $1
    `,[id]);

    if (!rows?.length) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    // JSONB из pg обычно уже объект; если вдруг строка — попробуем распарсить
    const r = rows[0];
    const tryParse = (v:any) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
      return v;
    };

    return NextResponse.json({
      ok: true,
      item: {
        ...r,
        matches: tryParse(r.matches),
        sources: tryParse(r.sources),
        meta: tryParse(r.meta),
      }
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message ?? "trace get failed" }, { status: 500 });
  }
}
