// apps/web/src/app/api/admin/sql/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { assertAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// Разрешаем строго:
//  • SELECT
//  • CREATE [UNIQUE] INDEX
//  • CREATE TABLE IF NOT EXISTS eval_traces (...)
// (как и раньше)
const ALLOWED = /^\s*(?:select|create\s+(?:unique\s+)?index|create\s+table\s+if\s+not\s+exists\s+eval_traces)\b/i;

export async function POST(req: NextRequest) {
  try {
    // единая проверка ключа: ADMIN_KEY + заголовок x-admin-key
    assertAdmin(req);

    const body = await req.json().catch(() => ({}));
    const sql: string = String(body?.sql ?? "");
    if (!sql || !ALLOWED.test(sql)) {
      return NextResponse.json(
        { ok: false, error: "expected { sql } and only SELECT / CREATE INDEX / CREATE TABLE eval_traces are allowed" },
        { status: 400 }
      );
    }

    const rows = await q<any>(sql);
    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    const msg = e?.message || "sql failed";
    const code = msg === "unauthorized" ? 401 : (msg === "ADMIN_KEY is not set" ? 500 : 500);
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
