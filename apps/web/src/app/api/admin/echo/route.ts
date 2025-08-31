// apps/web/src/app/api/admin/echo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ensureAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const chk = ensureAdmin(req);
  if (!chk.ok) {
    return NextResponse.json({ ok: false, error: "unauthorized", reason: chk.reason }, { status: 401 });
  }

  const headers = Object.fromEntries(
    Array.from(req.headers).filter(([k]) => k !== "cookie")
  );

  return NextResponse.json({ ok: true, headers }, { status: 200 });
}
