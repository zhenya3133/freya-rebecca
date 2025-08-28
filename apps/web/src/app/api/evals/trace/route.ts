// apps/web/src/app/api/evals/trace/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/evals/trace?id=<uuid>
 * Требует X-Admin-Key.
 */
export async function GET(req: NextRequest) {
  try {
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "query param 'id' is required" }, { status: 400 });
    }

    const rows = await q<any>(
      `
      SELECT id, ns, query, profile, model, ok, error, latency_ms, created_at,
             answer, matches, sources, meta
      FROM eval_traces
      WHERE id = $1
      `,
      [id]
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, item: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "trace failed" }, { status: 500 });
  }
}
