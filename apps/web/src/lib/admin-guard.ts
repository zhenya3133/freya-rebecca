// apps/web/src/lib/admin-guard.ts
import { NextRequest, NextResponse } from "next/server";

// безопасно парсим Bearer токен
function extractBearer(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(v);
  return m ? m[1].trim() : undefined;
}

/** Универсально достаём админ-ключ из заголовков ИЛИ query (?adminKey=). */
export function readAdminKey(req: NextRequest | Request): string | undefined {
  // 1) заголовки
  const hdr = req.headers?.get?.("x-admin-key") || extractBearer(req.headers?.get?.("authorization"));
  if (hdr && hdr.length > 0) return hdr;

  // 2) query (работает надёжно в dev на Windows)
  try {
    // NextRequest имеет nextUrl, но Request — нет (edge иногда даёт обычный Request)
    const url = (req as any).nextUrl?.href || (req as any).url;
    const sp = new URL(url).searchParams;
    const q = sp.get("adminKey");
    if (q && q.length > 0) return q;
  } catch {}
  return undefined;
}

/** true/false — админ ли запрос */
export function isAdmin(req: NextRequest | Request): boolean {
  const envKey = process.env.X_ADMIN_KEY || "";
  if (!envKey) return false;
  const got = readAdminKey(req);
  return !!got && got === envKey;
}

/** Если не админ — сразу 401. Иначе вернёт undefined (продолжайте обработку). */
export function requireAdmin(req: NextRequest): NextResponse | undefined {
  if (!process.env.X_ADMIN_KEY) {
    return NextResponse.json({ ok: false, error: "X_ADMIN_KEY not set" }, { status: 500 });
  }
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return undefined;
}
