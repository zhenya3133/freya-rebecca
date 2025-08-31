import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export async function GET() {
  try {
    const rows = await q<{ now: string }>('SELECT now()');
    return NextResponse.json({ ok: true, now: rows[0]?.now });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
