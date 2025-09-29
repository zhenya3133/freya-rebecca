// apps/web/src/app/api/debug/admin/route.ts
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const got = (req.headers.get("x-admin-key") || "").trim();
  const hasEnv = !!(process.env.X_ADMIN_KEY || "").trim();
  const equal = hasEnv && got === (process.env.X_ADMIN_KEY || "").trim();
  return NextResponse.json({
    hasEnv,
    receivedLen: got.length,
    equal
  });
}
