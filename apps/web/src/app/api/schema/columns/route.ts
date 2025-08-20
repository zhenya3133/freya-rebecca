import { NextResponse } from 'next/server';
import { q } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const columns = await q<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema='public'
       ORDER BY table_name, ordinal_position`
    );

    // Плюс сразу глянем, есть ли столбцы ns/namespace и сколько строк в них
    const probes = [
      { table: 'sources',   column: 'ns' },
      { table: 'sources',   column: 'namespace' },
      { table: 'chunks',    column: 'ns' },
      { table: 'chunks',    column: 'namespace' },
      { table: 'documents', column: 'ns' },
      { table: 'documents', column: 'namespace' },
    ];

    const stats: Array<{ table: string; column: string; count: number }> = [];
    for (const p of probes) {
      try {
        const r = await q<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${p.table}
           WHERE ${p.column} IS NOT NULL AND ${p.column} <> ''`
        );
        if (r?.[0]?.count !== undefined) {
          stats.push({ table: p.table, column: p.column, count: Number(r[0].count) });
        }
      } catch { /* колонка/таблица может отсутствовать — пропускаем */ }
    }

    return NextResponse.json({ ok: true, columns, stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
