// apps/web/src/app/api/db-ping/route.ts
import { NextResponse } from 'next/server';

// чтобы route был всегда динамический и не кешировался
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
