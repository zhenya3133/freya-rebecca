// apps/web/src/app/api/admin/sql/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

// Разрешаем только CREATE [UNIQUE] INDEX и SELECT
const ALLOWED = /^\s*(create\s+(unique\s+)?index|select)\b/i;

export async function POST(req: NextRequest) {
  try {
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) {
      // если ключ не задан — роут выключен (в проде можно просто не задавать ADMIN_KEY)
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const sql: string = String(body?.sql ?? "");
    if (!sql || !ALLOWED.test(sql)) {
      return NextResponse.json(
        { ok: false, error: "expected { sql } and only CREATE INDEX / SELECT are allowed" },
        { status: 400 }
      );
    }

    const rows = await q<any>(sql);
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "sql failed" }, { status: 500 });
  }
}
