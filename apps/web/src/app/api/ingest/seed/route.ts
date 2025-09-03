import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

type SeedItem = {
  title?: string;
  content: string;
};

type Body = {
  ns: string;
  items: SeedItem[];
  chunk?: { chars?: number; overlap?: number };
  minChars?: number; // дефолт 64 — сиды бывают короткими
};

export async function POST(req: Request) {
  const stage = { value: "init" as "init" | "validate" | "chunking" | "embedding" | "saving" };

  try {
    const body = (await req.json()) as Body;
    const ns = body?.ns?.trim();
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!ns || items.length === 0) {
      return NextResponse.json({ ok: false, error: "ns and items[] are required" }, { status: 400 });
    }

    stage.value = "validate";
    const minChars = Number.isFinite(body?.minChars) ? Math.max(0, Number(body!.minChars)) : 64;

    const texts: { content: string; meta: any }[] = [];
    for (const it of items) {
      const title = it?.title?.trim();
      const content = (it?.content ?? "").toString();
      if (content.length < minChars) {
        return NextResponse.json(
          { ok: false, error: "content too short", stage: "validate", debug: { title, len: content.length } },
          { status: 400 }
        );
      }
      texts.push({ content, meta: { title } });
    }

    stage.value = "chunking";
    const allChunks: { content: string; meta: any }[] = [];
    for (const t of texts) {
      const chunks = chunkText(t.content, body?.chunk);
      if (chunks.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Invalid after chunking", stage: "chunking", debug: t.meta },
          { status: 400 }
        );
      }
      chunks.forEach((c, idx) => allChunks.push({ content: c, meta: { ...t.meta, part: idx + 1 } }));
    }

    stage.value = "embedding";
    const embeddings = await embedMany(allChunks.map((c) => c.content));

    stage.value = "saving";
    const rows = allChunks.map((c, i) => ({
      ns,
      kind: "seed" as const,
      content: c.content,
      embedding: embeddings[i],
      metadata: { ...c.meta, chunk: normalizeChunkOpts(body?.chunk) }
    }));

    await upsertMemoriesBatch(rows as any);

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err), stage: stage.value }, { status: 500 });
  }
}
