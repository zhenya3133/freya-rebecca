// apps/web/src/app/api/health/env/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasDB = !!process.env.DATABASE_URL;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAdminKey = !!process.env.X_ADMIN_KEY;

  return NextResponse.json({
    ok: hasDB && hasOpenAI,
    has: {
      DATABASE_URL: hasDB,
      OPENAI_API_KEY: hasOpenAI,
      X_ADMIN_KEY: hasAdminKey
    }
  });
}
