// apps/web/src/app/api/admin/logs/list/route.ts
// GET /api/admin/logs/list?limit=10&ns=...&kind=...&kindPrefix=...&since=ISO
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normKind(v?: string | null) {
  if (!v) return undefined;
  return v.replace(/-/g, ".").trim();
}

export async function GET(req: NextRequest) {
  try {
    // мидлвар уже проверил x-admin-key / Authorization, сюда дошли только авторизованные
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "10", 10), 1), 100);
    const ns = sp.get("ns") || undefined;

    const kindExact = normKind(sp.get("kind"));
    const kindPrefix = normKind(sp.get("kindPrefix"));
    const since = sp.get("since") || undefined; // ISO строка, опционально

    let sql = `
      select id, kind, ns, profile, params, request, response, created_at
      from logs
      where 1=1
    `;
    const args: any[] = [];

    if (ns) {
      args.push(ns);
      sql += ` and ns = $${args.length}`;
    }

    if (kindExact) {
      args.push(kindExact);
      sql += ` and kind = $${args.length}`;
    }

    if (kindPrefix) {
      args.push(kindPrefix + "%");
      sql += ` and kind like $${args.length}`;
    }

    if (since) {
      args.push(new Date(since));
      sql += ` and created_at >= $${args.length}`;
    }

    args.push(limit);
    sql += ` order by created_at desc limit $${args.length}`;

    const rows = await q(sql, args);

    return NextResponse.json({ ok: true, count: rows.length, items: rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
