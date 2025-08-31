// apps/web/src/lib/admin-auth.ts
import { NextRequest } from "next/server";

export function readAdminKey(req: NextRequest): string | null {
  const hdr = req.headers.get("x-admin-key");
  const auth = req.headers.get("authorization");
  const fromBearer = auth && /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const sp = req.nextUrl.searchParams;
  const fromQuery =
    sp.get("adminKey") ||
    sp.get("x-admin-key") ||
    sp.get("adminkey") ||
    null;
  return hdr || fromBearer || fromQuery;
}

export function ensureAdmin(req: NextRequest): { ok: true } | { ok: false; reason: string } {
  const want = (process.env.X_ADMIN_KEY || "").trim();
  if (!want) return { ok: false, reason: "X_ADMIN_KEY is not set" };
  const got = (readAdminKey(req) || "").trim();
  if (!got) return { ok: false, reason: "missing" };
  if (got !== want) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
