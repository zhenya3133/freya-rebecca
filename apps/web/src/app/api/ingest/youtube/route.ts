import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

type Body = {
  ns: string;
  videoId?: string;   // опционально, если сами тянете транскрипт снаружи
  transcript?: string; // готовый текст транскрипта
  chunk?: { chars?: number; overlap?: number };
};

export async function POST(req: Request) {
  const stage = { value: "init" as "init" | "validate" | "chunking" | "embedding" | "saving" };

  try {
    const b = (await req.json()) as Body;
    const ns = b?.ns?.trim();
    const transcript = (b?.transcript ?? "").toString();

    if (!ns || !transcript) {
      return NextResponse.json({ ok: false, error: "ns and transcript are required" }, { status: 400 });
    }

    stage.value = "chunking";
    const chunks = chunkText(transcript, b?.chunk);
    if (chunks.length === 0) {
      return NextResponse.json({ ok: false, error: "empty after chunking", stage: "chunking" }, { status: 400 });
    }

    stage.value = "embedding";
    const embeddings = await embedMany(chunks);

    stage.value = "saving";
    const rows = chunks.map((content, i) => ({
      ns,
      kind: "youtube" as const,
      content,
      embedding: embeddings[i],
      metadata: { videoId: b?.videoId, chunk: normalizeChunkOpts(b?.chunk) }
    }));

    await upsertMemoriesBatch(rows as any);

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err), stage: stage.value }, { status: 500 });
  }
}
