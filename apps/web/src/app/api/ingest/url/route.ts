// apps/web/src/app/api/ingest/url/route.ts
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { chunkText } from "../../../../lib/chunk";
import { upsertMemoriesBatch } from "../../../../lib/memories";

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/url
 * Body: { url: string; kind: string; chunk?: { size?: number; overlap?: number; minSize?: number } }
 * Требует заголовок: x-admin-key
 */
export async function POST(req: Request) {
  try {
    const { url, kind, chunk } = await req.json() as {
      url?: string; kind?: string; chunk?: { size?: number; overlap?: number; minSize?: number };
    };
    if (!url || !kind) return NextResponse.json({ ok:false, error:"url and kind are required" }, { status:400 });

    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return NextResponse.json({ ok:false, error:`fetch failed: ${res.status}` }, { status:502 });

    const html = await res.text();
    const $ = cheerio.load(html);

    // убираем шум
    $("script, style, noscript, svg, iframe, footer, nav").remove();
    const title = $("title").first().text().trim();

    // пробуем найти основной блок, иначе берём body
    const root = $("article, main, #content, .content").first().length ? $("article, main, #content, .content").first() : $("body");
    const text = root.text().replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();

    if (!text || text.length < 200) {
      return NextResponse.json({ ok:false, error:"content too short" }, { status:422 });
    }

    const pieces = chunkText(text, { size: chunk?.size ?? 1500, overlap: chunk?.overlap ?? 200, minSize: chunk?.minSize ?? 400 });
    const items = pieces.map((content, idx) => ({
      content,
      metadata: { source_type: "url", url, title, chunk_index: idx }
    }));

    const inserted = await upsertMemoriesBatch(kind, items);
    return NextResponse.json({ ok:true, inserted, count: inserted.length, kind, title });
  } catch (e:any) {
    console.error("POST /api/ingest/url error:", e?.message ?? e);
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
