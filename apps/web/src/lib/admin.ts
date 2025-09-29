// apps/web/src/lib/admin.ts
import { NextRequest } from "next/server";

/**
 * Проверяем админ-доступ по заголовку x-admin-key.
 * Допускаем ИЛИ ADMIN_KEY, ИЛИ X_ADMIN_KEY из окружения (если заданы оба — любой из них).
 */
export function assertAdmin(req: NextRequest | Request): void {
  const wantA = (process.env.ADMIN_KEY || "").trim();
  const wantB = (process.env.X_ADMIN_KEY || "").trim(); // на проектах уже используется для ingest
  const got = (req.headers.get("x-admin-key") || "").trim();

  // если оба пустые — считаем, что админ-защита не настроена (не безопасно, но не блокируем локальную разработку)
  if (!wantA && !wantB) return;

  const ok =
    (!!wantA && got === wantA) ||
    (!!wantB && got === wantB);

  if (!ok) throw new Error("unauthorized");
}
