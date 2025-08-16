// apps/web/src/app/api/health/db/route.ts
import { pool } from "@/lib/db";
export const runtime = "nodejs";

export async function GET() {
  try {
    const r = await pool.query("select version() as v, now() as t");
    return new Response(
      JSON.stringify({ ok: true, version: r.rows[0].v, now: r.rows[0].t }),
      { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}
