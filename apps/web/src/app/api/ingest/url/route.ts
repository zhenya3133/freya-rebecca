// apps/web/src/app/api/ingest/url/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  url: string;
  slot?: string | null;
  kind?: string | null;
  chunk?: { chars?: number; overlap?: number };
};

function assertAdmin(req: Request) {
  const need = (process.env.X_ADMIN_KEY || "").trim();
  if (!need) return;
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (need && got !== need) throw new Error("unauthorized");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    assertAdmin(req);
    const { ns, url, slot = "staging", kind = "url", chunk } = (await req.json()) as Body;
    if (!ns || !url) {
      return NextResponse.json({ ok: false, error: "ns and url are required" }, { status: 400 });
    }

    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`fetch failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const raw = await res.text();
    const text = ct.includes("html") ? stripTags(raw) : raw;
    if (!text?.trim()) throw new Error("empty text extracted");

    const opts = normalizeChunkOpts(chunk);
    const chunks = chunkText(text, opts);
    const vectors = await embedMany(chunks);

    const records = chunks.map((content, i) => ({
      kind: kind || "url",
      ns,
      slot,
      content,
      embedding: vectors[i],
      metadata: {
        source_type: "url",
        url,
        content_type: ct,
        chunk_index: i,
        chunk_chars: content.length,
        chunk: opts,
      },
    }));
    const written: number = await upsertMemoriesBatch(records);

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      url,
      chunks: chunks.length,
      written,
           ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
