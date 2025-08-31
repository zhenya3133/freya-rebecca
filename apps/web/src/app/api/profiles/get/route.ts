/**
 * src/app/api/profiles/get/route.ts
 * GET /api/profiles/get?name=...&kind=...&tag=...&q=...
 */
import { NextRequest, NextResponse } from "next/server";
import { loadProfiles, filterProfiles } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const name = sp.get("name") ?? undefined;
    const kind = sp.get("kind") ?? undefined;
    const tag  = sp.get("tag") ?? undefined;
    const q    = sp.get("q") ?? undefined;

    const list = await loadProfiles();
    const items = filterProfiles(list, { name, kind, tag, q });

    const body = {
      version: "v1",
      total: list.length,
      count: items.length,
      filters: { name, kind, tag, q },
      items,
    };

    const res = NextResponse.json(body, { status: 200 });
    res.headers.set("Cache-Control", "public, max-age=60, s-maxage=60");
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
