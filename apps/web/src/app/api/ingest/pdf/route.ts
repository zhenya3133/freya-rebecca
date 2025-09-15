// apps/web/src/app/api/ingest/pdf/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import fs from "node:fs/promises";
import path from "node:path";

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

async function fetchPdfAsBuffer(url: string): Promise<Buffer> {
  // Локальный путь для отладки: url = file:///abs/path/to/file.pdf
  if (url.startsWith("file://")) {
    const p = url.replace("file://", "");
    const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
    return await fs.readFile(abs);
  }

  // HTTP(S)
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function extractTextFromPdf(buf: Buffer): Promise<{ text: string; pages?: number }> {
  // Импортируем напрямую lib-реализацию, минуя index.js с "debug mode"
  const mod: any = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod?.default ?? mod; // совместимо с ESM/CJS
  const out = await pdfParse(buf);
  return { text: out.text || "", pages: out.numpages };
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    assertAdmin(req);
    const { ns, url, slot = "staging", kind = "pdf", chunk } = (await req.json()) as Body;
    if (!ns || !url) {
      return NextResponse.json({ ok: false, error: "ns and url are required" }, { status: 400 });
    }

    const buf = await fetchPdfAsBuffer(url);
    const { text, pages } = await extractTextFromPdf(buf);
    if (!text?.trim()) throw new Error("empty text extracted from PDF");

    const opts = normalizeChunkOpts(chunk);
    const chunks = chunkText(text, opts);
    if (!chunks.length) throw new Error("no chunks produced");

    const vectors = await embedMany(chunks);

    const records = chunks.map((content, i) => ({
      kind: kind || "pdf",
      ns,
      slot,
      content,
      embedding: vectors[i],
      metadata: {
        source_type: "pdf",
        url,
        page_count: pages,
        chunk_index: i,
        chunk_chars: content.length,
        chunk: opts,
      },
    }));

    const { written, ids } = await upsertMemoriesBatch(records);
    return NextResponse.json({
      ok: true,
      ns,
      slot,
      url,
      pages,
      chunks: chunks.length,
      written,
      ids,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage: "extract", error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
