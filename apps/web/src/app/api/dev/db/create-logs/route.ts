// apps/web/src/app/api/dev/db/create-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key") || "";
  if (!process.env.X_ADMIN_KEY || adminKey !== process.env.X_ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stmts = [
    `create extension if not exists pgcrypto`,
    `create table if not exists logs (
       id uuid primary key default gen_random_uuid(),
       kind text not null,
       ns text,
       profile text,
       params jsonb,
       request jsonb,
       response jsonb,
       created_at timestamptz not null default now()
     )`,
    `create index if not exists logs_created_at_idx on logs(created_at desc)`,
    `create index if not exists logs_kind_idx on logs(kind)`
  ];

  const results: Array<{ sql: string; ok: boolean; error?: string }> = [];
  for (const sql of stmts) {
    try {
      await q(sql, []);
      results.push({ sql, ok: true });
    } catch (e: any) {
      results.push({ sql, ok: false, error: String(e?.message ?? e) });
      return NextResponse.json({ ok: false, stepFailed: sql, results }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, results }, { status: 200 });
}
