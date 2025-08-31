// apps/web/src/app/api/admin/whoami/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readAdminKey, ensureAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const want = (process.env.X_ADMIN_KEY || "").trim();
  const got = (readAdminKey(req) || "");
  const chk = ensureAdmin(req);

  return NextResponse.json(
    { hasEnv: want.length > 0, gotLen: got.length, ok: chk.ok },
    { status: 200 }
  );
}
