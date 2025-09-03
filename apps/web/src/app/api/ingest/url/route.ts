import { NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

type Body = {
  ns: string;
  url: string;
  kind?: "web";
  asMarkdown?: boolean; // парсить как «чистый текст» (Readability)
  chunk?: { chars?: number; overlap?: number };
  minChars?: number; // минимальный допуск длины текста (по умолчанию 160)
};

function extractMainText(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const raw = article?.textContent || dom.window.document.body.textContent || "";
  return raw.replace(/\s+\n/g, "\n").replace(/\n{2,}/g, "\n\n").trim();
}

export async function POST(req: Request) {
  const stage = { value: "init" as
    | "init"
    | "fetch"
    | "extract"
    | "chunking"
    | "embedding"
    | "saving" };

  try {
    const body = (await req.json()) as Body;
    const ns = body?.ns?.trim();
    const url = body?.url?.trim();
    const asMarkdown = body?.asMarkdown !== false; // по умолчанию включено

    if (!ns || !url) {
      return NextResponse.json({ ok: false, error: "ns and url are required" }, { status: 400 });
    }

    stage.value = "fetch";
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch failed (${res.status})` }, { status: 502 });
    }

    stage.value = "extract";
    const html = await res.text();
    const rawText = asMarkdown ? extractMainText(html, url) : html;

    const minChars = Number.isFinite(body?.minChars) ? Math.max(0, Number(body!.minChars)) : 160;
    if ((rawText?.length ?? 0) < minChars) {
      return NextResponse.json(
        { ok: false, error: `content too short (${rawText?.length ?? 0})`, stage: "extract" },
        { status: 400 }
      );
    }

    stage.value = "chunking";
    const chunks = chunkText(rawText, body?.chunk);
    if (chunks.length === 0) {
      return NextResponse.json({ ok: false, error: "empty after chunking", stage: "chunking" }, { status: 400 });
    }

    stage.value = "embedding";
    const embeddings = await embedMany(chunks);

    stage.value = "saving";
    const rows = chunks.map((content, i) => ({
      ns,
      kind: "web" as const,
      content,
      embedding: embeddings[i],
      metadata: { url, extractor: asMarkdown ? "readability" : "raw-html", chunk: normalizeChunkOpts(body?.chunk) }
    }));

    await upsertMemoriesBatch(rows as any);

    return NextResponse.json({
      ok: true,
      inserted: rows.length,
      preview: { len: rawText.length, first: chunks[0]?.slice(0, 140) ?? "" }
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err), stage: stage.value },
      { status: 500 }
    );
  }
}
