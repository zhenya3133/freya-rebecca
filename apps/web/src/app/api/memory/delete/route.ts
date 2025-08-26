// apps/web/src/app/api/memory/delete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

type Slot = "staging" | "prod";

export async function POST(req: NextRequest) {
  try {
    // защита ключом — в .env.local должен быть ADMIN_KEY=dev-12345 (как у тебя)
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({} as any));
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    const slot: Slot = body?.slot === "prod" ? "prod" : "staging";

    // Вариант 1: удаление по списку id (рекомендуется)
    if (ids.length > 0) {
      const rows = await q<any>(
        `delete from chunks where id = any($1::uuid[]) returning id`,
        [ids]
      );
      return NextResponse.json({ ok: true, mode: "byIds", deleted: rows.length, ids: rows.map((r: any) => r.id) });
    }

    // Вариант 2: удаление по фильтрам (требует ns)
    const ns = String(body?.ns ?? "").trim();
    if (!ns) {
      return NextResponse.json({ ok: false, error: "expected { ids[] } OR { ns, ...filters }" }, { status: 400 });
    }

    const kind = body?.kind ? String(body.kind).trim() : null;
    const qtext = body?.q ? String(body.q).trim() : null;
    const before = body?.before ? new Date(String(body.before)) : null; // ISO или любая дата
    const after  = body?.after  ? new Date(String(body.after))  : null;
    const limit  = Math.max(1, Math.min(Number(body?.limit ?? 500), 5000));
    const dryRun = body?.dryRun === true;

    // WHERE
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    where.push(`ns = $${i++}`); params.push(ns);
    where.push(`slot = $${i++}`); params.push(slot);
    if (kind) { where.push(`(source->>'kind') = $${i++}`); params.push(kind); }
    if (qtext) { where.push(`(content ilike $${i} or source::text ilike $${i})`); params.push(`%${qtext}%`); i++; }
    if (before && !isNaN(before.getTime())) { where.push(`created_at <= $${i++}`); params.push(before.toISOString()); }
    if (after  && !isNaN(after.getTime()))  { where.push(`created_at >= $${i++}`); params.push(after.toISOString()); }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    if (dryRun) {
      const totalRows = await q<any>(`select count(*) as n from chunks ${whereSql}`, params);
      const total = Number(totalRows?.[0]?.n || 0);
      const sample = await q<any>(
        `select id from chunks ${whereSql} order by created_at desc limit $${i}`,
        [...params, Math.min(50, limit)]
      );
      return NextResponse.json({
        ok: true, mode: "dryRun", totalMatches: total,
        wouldDelete: Math.min(total, limit),
        sampleIds: sample.map((r: any) => r.id)
      });
    }

    // Удаляем порциями через CTE с лимитом
    const del = await q<any>(
      `
      with to_del as (
        select id from chunks
        ${whereSql}
        order by created_at desc
        limit $${i}
      )
      delete from chunks c
      using to_del
      where c.id = to_del.id
      returning c.id
      `,
      [...params, limit]
    );

    return NextResponse.json({ ok: true, mode: "byFilter", deleted: del.length, ids: del.map((r: any) => r.id) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "memory delete failed" }, { status: 500 });
  }
}
