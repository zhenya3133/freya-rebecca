// apps/web/src/app/api/diag/chunks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ns = searchParams.get("ns") || "";
  const slot = (searchParams.get("slot") as "staging" | "prod") || "staging";
  const limit = Number(searchParams.get("limit") || "5");
  if (!ns) return NextResponse.json({ error: "ns is required" }, { status: 400 });

  const rows = await q<any>(
    `select id, corpus_id, created_at, left(content, 140) as preview
       from chunks
      where ns = $1 and slot = $2
      order by created_at desc
      limit $3`,
    [ns, slot, limit]
  );
  return NextResponse.json({ ns, slot, count: rows.length, rows }, { status: 200 });
}
