import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

/** Полная зачистка по ns во всех слотах (dev-инструмент). */
export async function POST(req: NextRequest) {
  try {
    const { ns } = await req.json().catch(() => ({}));
    if (!ns) return NextResponse.json({ error: "ns is required" }, { status: 400 });
    const del = await q(`delete from chunks where ns = $1 returning id`, [ns]);
    return NextResponse.json({ ns, removed: del.length }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
