// apps/web/src/app/api/ingest/url/route.ts
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { chunkText } from "@/lib/chunk";
import { upsertMemoriesBatch } from "@/lib/memories";

export const dynamic = "force-dynamic";

async function fetchWithFallback(url: string) {
  // 1) обычный fetch как браузер
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,ru;q=0.8",
    },
  });
  if (res.ok) {
    const html = await res.text();
    return { html, from: "origin" as const };
  }

  // 2) fallback: r.jina.ai (читабельная версия страницы)
  const jinaUrl =
    "https://r.jina.ai/http://" + url.replace(/^https?:\/\//i, "");
  const jr = await fetch(jinaUrl, { headers: { "user-agent": "curl/8" } });
  if (jr.ok) {
    const text = await jr.text(); // уже очищенный текст
    // упакуем как минимальный HTML, чтобы единый пайп ниже работал
    const html = `<article>${text.replace(/\n/g, "<br/>")}</article>`;
    return { html, from: "jina" as const };
  }

  throw new Error(`fetch failed: ${res.status}; jina: ${jr.status}`);
}

/**
 * POST /api/ingest/url
 * Body: { url: string; kind: string; chunk?: { size?: number; overlap?: number; minSize?: number } }
 * Требует заголовок: x-admin-key
 */
export async function POST(req: Request) {
  try {
    const { url, kind, chunk } = (await req.json()) as {
      url?: string;
      kind?: string;
      chunk?: { size?: number; overlap?: number; minSize?: number };
    };
    if (!url || !kind)
      return NextResponse.json(
        { ok: false, error: "url and kind are required" },
        { status: 400 }
      );

    const { html, from } = await fetchWithFallback(url);
    const $ = cheerio.load(html);

    $("script, style, noscript, svg, iframe, footer, nav").remove();
    const title =
      $("title").first().text().trim() ||
      $("h1").first().text().trim() ||
      url;

    const root =
      $("article, main, #content, .content").first().length
        ? $("article, main, #content, .content").first()
        : $("body");
    const text = root.text().replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();

    if (!text || text.length < 200) {
      return NextResponse.json(
        { ok: false, error: `content too short (${text?.length ?? 0})` },
        { status: 422 }
      );
    }

    const pieces = chunkText(text, {
      size: chunk?.size ?? 1500,
      overlap: chunk?.overlap ?? 200,
      minSize: chunk?.minSize ?? 400,
    });
    const items = pieces.map((content, idx) => ({
      content,
      metadata: { source_type: "url", url, title, from, chunk_index: idx },
    }));

    const inserted = await upsertMemoriesBatch(kind, items);
    return NextResponse.json({
      ok: true,
      inserted,
      count: inserted.length,
      kind,
      title,
      from,
    });
  } catch (e: any) {
    console.error("POST /api/ingest/url error:", e?.message ?? e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
