// apps/web/src/app/api/debug/logs/route.ts
import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await q(`select 1 from logs limit 1`, []);
    return NextResponse.json({ ok: true, exists: true });
  } catch {
    return NextResponse.json({ ok: true, exists: false });
  }
}
