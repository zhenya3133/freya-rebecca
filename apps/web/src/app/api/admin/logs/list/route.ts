// apps/web/src/app/api/admin/logs/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/logs/list
 * Параметры (все опциональны, но авторизация обязателена через middleware):
 *   limit   : number (1..200, по умолчанию 20)
 *   ns      : string
 *   kind    : string
 *   profile : string
 *   since   : ISO-датавремя (вернём логи >= since)
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const limitRaw = Number(sp.get("limit") ?? 20);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 20));

    const ns = sp.get("ns") ?? undefined;
    const kind = sp.get("kind") ?? undefined;
    const profile = sp.get("profile") ?? undefined;
    const since = sp.get("since") ?? undefined;

    const where: string[] = [];
    const params: any[] = [];

    const add = (clause: string, value: any) => {
      params.push(value);
      where.push(clause.replace("$$", `$${params.length}`));
    };

    if (ns) add("ns = $$", ns);
    if (kind) add("kind = $$", kind);
    if (profile) add("profile = $$", profile);
    if (since) add("created_at >= $$", new Date(since));

    // LIMIT как последний параметр
    params.push(limit);
    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const sql = `
      select id, kind, ns, profile, params, request, response, created_at
      from logs
      ${whereSql}
      order by created_at desc
      limit $${params.length}
    `;

    const rows = await q(sql, params);

    return NextResponse.json({ ok: true, count: rows.length, items: rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
