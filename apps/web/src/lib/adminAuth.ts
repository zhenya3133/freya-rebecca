// apps/web/src/lib/adminAuth.ts
import { NextRequest, NextResponse } from "next/server";

function normalize(s: string) {
  return (s || "").trim();
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  const ADMIN_KEY = normalize(process.env.X_ADMIN_KEY || "");
  const url = new URL(req.url);
  const got = normalize(
    (req.headers.get("x-admin-key") || url.searchParams.get("adminKey") || "")
  );

  if (!ADMIN_KEY || got !== ADMIN_KEY) {
    return new NextResponse(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "content-type": "application/json; charset=utf-8" } }
    );
  }
  return null;
}
