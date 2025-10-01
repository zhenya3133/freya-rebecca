// apps/web/src/app/api/memory/promote/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import crypto from "crypto";

export const runtime = "nodejs";

type Slot = "staging" | "prod";
const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

type Row = {
  id: string;
  corpus_id: string;
  ns: string;
  slot: Slot;
  created_at: string;
  content: string;
  emb_text: string;
  source: any;
  content_hash: string;
};

export async function POST(req: NextRequest) {
  try {
    const expect = process.env.ADMIN_KEY?.trim();
    if (!expect) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    const got = req.headers.get("x-admin-key")?.trim();
    if (got !== expect) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const ns = String(body?.ns ?? "").trim();
    const from: Slot = body?.from === "prod" ? "prod" : "staging";
    const to: Slot   = body?.to   === "staging" ? "staging" : "prod";
    const kind = body?.kind ? String(body.kind).trim() : null;

    const rawIds: string[] = Array.isArray(body?.ids)
      ? body.ids.map(String).map((s: string) => s.trim()).filter(Boolean)
      : [];
    const goodIds = rawIds.filter(isUuid);
    const badIds  = rawIds.filter(id => !isUuid(id));

    const limit = Math.max(1, Math.min(Number(body?.limit ?? 1000), 5000));
    const dryRun = body?.dryRun === true;

    if (!ns) return NextResponse.json({ ok: false, error: "expected { ns }" }, { status: 400 });
    if (from === to) return NextResponse.json({ ok: false, error: "`from` must differ from `to`" }, { status: 400 });
    if (rawIds.length > 0 && goodIds.length === 0)
      return NextResponse.json({ ok: false, error: "ids contain no valid UUID", badIds }, { status: 400 });

    // WHERE
    const params: any[] = [];
    const where: string[] = [];
    let i = 1;

    where.push(`ns = $${i++}`);   params.push(ns);
    where.push(`slot = $${i++}`); params.push(from);
    if (kind) { where.push(`(source->>'kind') = $${i++}`); params.push(kind); }
    if (goodIds.length > 0) { where.push(`id = any($${i++}::uuid[])`); params.push(goodIds); }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    const totalRows = await q<any>(`select count(*) as n from chunks ${whereSql}`, params);
    const total = Number(totalRows?.[0]?.n || 0);

    if (dryRun) {
      const sample = await q<any>(
        `select id from chunks ${whereSql} order by created_at asc limit $${i}`,
        [...params, Math.min(50, limit)]
      );
      return NextResponse.json({
        ok: true, mode: "dryRun", ns, from, to,
        totalMatches: total, badIds,
        sampleIds: sample.map((r: any) => r.id)
      });
    }

    if (total === 0) {
      return NextResponse.json({ ok: true, ns, from, to, promoted: 0, skipped: 0, badIds });
    }

    const rows = await q<Row>(
      `
      select
        id, corpus_id, ns, slot, created_at,
        content, (embedding::text) as emb_text,
        source, content_hash
      from chunks
      ${whereSql}
      order by created_at asc
      limit $${i}
      `,
      [...params, limit]
    );

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, ns, from, to, promoted: 0, skipped: 0, badIds });
    }

    const hashes = rows.map(r => r.content_hash);
    const exist = await q<any>(
      `select content_hash from chunks where ns = $1 and slot = $2 and content_hash = any($3::text[])`,
      [ns, to, hashes]
    );
    const existsSet = new Set<string>(exist.map((r: any) => r.content_hash));

    let promoted = 0, skipped = 0;
    for (const r of rows) {
      const overwrite = body?.overwrite === true;
if (existsSet.has(r.content_hash)) {
  if (!overwrite) { skipped++; continue; }
  // вычищаем дубликат(ы) в целевом слоте и продолжаем вставку
  await q(`delete from chunks where ns = $1 and slot = $2 and content_hash = $3`, [ns, to, r.content_hash]);
}
      const id = crypto.randomUUID();
      await q(
        `
        insert into chunks
          (id, corpus_id, ns, slot, content, embedding, source, content_hash, created_at)
        values
          ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8, now())
        on conflict do nothing
        `,
        [id, r.corpus_id, ns, to, r.content, r.emb_text, JSON.stringify(r.source), r.content_hash]
      );
      promoted++;
    }

    return NextResponse.json({
      ok: true, ns, from, to,
      promoted, skipped, considered: rows.length, totalCandidates: total, badIds
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "promote failed" }, { status: 500 });
  }
}
