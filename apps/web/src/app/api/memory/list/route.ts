// apps/web/src/app/api/memory/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";

type Row = {
  id: string;
  corpus_id: string;
  ns: string;
  slot: "staging" | "prod";
  created_at: string;
  title: string | null;
  kind: string | null;
  metadata: any;
  preview?: string; // когда full=0
  content?: string; // когда full=1
  content_len: number;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // ВАЖНО: здесь больше НЕТ проверки ключа — роут публичный.
    // admin-key остаётся только у /api/admin/sql

    const ns = url.searchParams.get("ns")?.trim();
    if (!ns) {
      return NextResponse.json(
        { ok: false, error: "query param 'ns' is required" },
        { status: 400 }
      );
    }

    const slot = (url.searchParams.get("slot") === "prod" ? "prod" : "staging") as
      | "staging"
      | "prod";
    const kind = url.searchParams.get("kind")?.trim() || null;
    const qtext = url.searchParams.get("q")?.trim() || null;
    const order = (url.searchParams.get("order") === "asc" ? "asc" : "desc") as
      | "asc"
      | "desc";
    const full = url.searchParams.get("full") === "1";

    const limit = Math.max(
      1,
      Math.min(Number(url.searchParams.get("limit") || "20"), 100)
    );
    const offset = Math.max(0, Number(url.searchParams.get("offset") || "0"));
    const previewChars = Math.max(
      40,
      Math.min(Number(url.searchParams.get("preview") || "420"), 5000)
    );

    // ids=uuid1,uuid2,...
    const idsCsv = url.searchParams.get("ids")?.trim();
    const ids = idsCsv
      ? idsCsv.split(",").map((s) => s.trim()).filter(Boolean)
      : null;

    // ------- WHERE -------
    const params: any[] = [];
    const where: string[] = [];
    let i = 1;

    where.push(`ns = $${i++}`); params.push(ns);
    where.push(`slot = $${i++}`); params.push(slot);

    if (kind) { where.push(`(source->>'kind') = $${i++}`); params.push(kind); }
    if (qtext) {
      where.push(`(content ilike $${i} or source::text ilike $${i})`);
      params.push(`%${qtext}%`);
      i++;
    }
    if (ids && ids.length) {
      const ph = ids.map(() => `$${i++}`).join(",");
      where.push(`id in (${ph})`);
      params.push(...ids);
    }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    // ------- total -------
    const totalRows = await q<any>(
      `select count(*) as n from chunks ${whereSql}`, params
    );
    const total = Number(totalRows?.[0]?.n || 0);

    // ------- SELECT -------
    const selectCols = full
      ? `id, corpus_id, ns, slot, created_at,
         (source->>'title')    as title,
         (source->>'kind')     as kind,
         (source->'metadata')  as metadata,
         content,
         length(content)       as content_len`
      : `id, corpus_id, ns, slot, created_at,
         (source->>'title')    as title,
         (source->>'kind')     as kind,
         (source->'metadata')  as metadata,
         substr(content, 1, $${i}) as preview,
         length(content)       as content_len`;

    const rows = await q<Row>(
      `
      select ${selectCols}
      from chunks
      ${whereSql}
      order by created_at ${order}
      limit $${i + (full ? 0 : 1)} offset $${i + (full ? 1 : 2)}
      `,
      full ? [...params, limit, offset] : [...params, previewChars, limit, offset]
    );

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      total,
      limit,
      offset,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
      items: rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "memory list failed" },
      { status: 500 }
    );
  }
}
