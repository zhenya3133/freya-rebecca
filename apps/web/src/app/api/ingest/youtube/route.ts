// apps/web/src/app/api/ingest/youtube/route.ts
import { NextResponse } from "next/server";

/**
 * ЖЁСТКАЯ ЗАГЛУШКА YouTube-инжеста.
 * Всегда возвращает 503 и не выполняет никакой логики.
 * Оставлена переменная флага на будущее (YT_INGEST_DISABLED),
 * но по факту тут всё равно 503.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Унифицированный ответ
function disabledResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "youtube ingest temporarily disabled",
      hint:
        "Фича отключена на время. Используй /api/ingest/seed или скрипты DOC/PDF/OCR.",
      ts: new Date().toISOString(),
    },
    { status: 503 }
  );
}

// Любой POST → 503
export async function POST() {
  return disabledResponse();
}

// На случай, если кто-то пингует GET/HEAD — тоже 503
export async function GET() {
  return disabledResponse();
}
export async function HEAD() {
  return disabledResponse();
}
