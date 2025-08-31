// apps/web/middleware.ts
import { NextRequest, NextResponse } from "next/server";

// Какие префиксы нормализуем (ключ -> заголовки)
const PROTECTED_PREFIXES = ["/api/admin", "/api/ingest", "/api/dev"];

// Тег, чтобы увидеть в эхо-ручке, какой middleware реально сработал
const MW_TAG = "mw-soft@root";

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // только для защищённых путей
  const need = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!need) return NextResponse.next();

  // читаем ключ из разных мест
  const fromHeader = req.headers.get("x-admin-key");
  const fromAuth = req.headers.get("authorization");
  const fromQuery =
    searchParams.get("adminKey") ||
    searchParams.get("x-admin-key") ||
    searchParams.get("adminkey") ||
    undefined;

  // если в заголовках нет, но есть где-то ещё — доливаем
  const out = new Headers(req.headers);
  const token =
    fromHeader ||
    (fromAuth && /^Bearer\s+(.+)$/.exec(fromAuth)?.[1]) ||
    fromQuery ||
    "";

  if (!fromHeader && token) out.set("x-admin-key", token);
  if (!fromAuth && token) out.set("authorization", `Bearer ${token}`);

  // метка, чтобы увидеть в /api/admin/echo
  out.set("x-mw-tag", MW_TAG);

  // ВАЖНО: ни каких 401/403 здесь — пусть решает сам роут
  return NextResponse.next({ request: { headers: out } });
}

export const config = {
  matcher: ["/api/:path*"],
};
