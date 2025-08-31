import { NextResponse } from 'next/server';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1) distinct kind
    const kindRows = await q<{ kind: string }>(
      `SELECT DISTINCT kind
         FROM memories
        WHERE kind IS NOT NULL AND kind <> ''
        ORDER BY kind`
    );
    const set = new Set<string>(kindRows.map(r => r.kind));

    // 2) попытка извлечь metadata->>'ns' (если metadata валидный JSON)
    try {
      const metaRows = await q<{ ns: string }>(
        `SELECT DISTINCT (metadata::jsonb ->> 'ns') AS ns
           FROM memories
          WHERE metadata IS NOT NULL
            AND (metadata::jsonb ? 'ns')
            AND (metadata::jsonb ->> 'ns') <> ''`
      );
      for (const r of metaRows) if (r.ns) set.add(r.ns);
    } catch {
      // Если metadata не JSON — тихо игнорируем и оставляем только kind
    }

    const namespaces = Array.from(set).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ ok: true, namespaces });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
