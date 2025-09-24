import { NextResponse } from "next/server";
import { upsertChunks, IngestDoc } from "@/lib/ingest_upsert";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  url: string;                   // исходный URL (или file:// для локалки)
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;
  chunk?: { chars?: number; overlap?: number };
  maxFileBytes?: number | null;  // лимит загрузки (байт), опционально
};

function assertAdmin(req: Request) {
  const need = (process.env.X_ADMIN_KEY || "").trim();
  if (!need) return;
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (need && got !== need) throw new Error("unauthorized");
}

async function importPdfParse(): Promise<(buf: Buffer) => Promise<any>> {
  const mod: any = await import("pdf-parse");
  const pdfParse = mod?.default ?? mod;
  return (buf: Buffer) => pdfParse(buf);
}

async function fetchAsBuffer(url: string, maxBytes?: number): Promise<Buffer> {
  if (url.startsWith("file://")) {
    const { readFile } = await import("node:fs/promises");
    const p = url.slice("file://".length);
    return readFile(p);
  }
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${r.statusText}`);
  const reader = r.body?.getReader();
  if (!reader) return Buffer.from(await r.arrayBuffer());
  const parts: Uint8Array[] = [];
  let total = 0, limit = Number(maxBytes) || Infinity;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) throw new Error(`response too large (${total} > ${limit})`);
      parts.push(value);
    }
  }
  return Buffer.concat(parts);
}

// Фоллбэк: расплющиваем PDF через r.jina.ai (на случай 5xx)
async function fetchPdfViaJina(url: string): Promise<string> {
  const enc = encodeURI(url).replace(/^https?:\/\//, "");
  const jina = `https://r.jina.ai/https://${enc}`;
  const r = await fetch(jina, { redirect: "follow" });
  if (!r.ok) throw new Error(`Jina ${r.status} ${r.statusText}`);
  return await r.text();
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  try {
    assertAdmin(req);
    const body = (await req.json()) as Body;

    const ns   = (body.ns   || "").trim();
    const url  = (body.url  || "").trim();
    const slot = ((body.slot || "staging") as "staging" | "prod");
    const kind = (body.kind  || "pdf");
    const opts = normalizeChunkOpts(body.chunk);
    const MAXB = Number.isFinite(Number(body.maxFileBytes)) ? Math.max(50_000, Number(body.maxFileBytes)) : undefined;

    if (!ns || !url) {
      return NextResponse.json({ ok: false, stage, error: "ns and url are required" }, { status: 400 });
    }
    if (!["staging","prod"].includes(slot)) {
      return NextResponse.json({ ok: false, stage, error: "slot must be 'staging'|'prod'" }, { status: 400 });
    }

    // 1) достаём PDF
    stage = "download";
    let text = "";
    let pages: number | undefined;

    try {
      const buf = await fetchAsBuffer(url, MAXB);
      const pdfParse = await importPdfParse();
      stage = "pdf-parse";
      const out = await pdfParse(buf);
      text  = (out?.text || "").trim();
      pages = out?.numpages;
    } catch {
      // 2) фоллбэк через Jina Reader
      stage = "fallback-jina";
      text = (await fetchPdfViaJina(url)).trim();
    }

    if (!text) throw new Error("empty text extracted from PDF");

    // 3) чанкинг
    stage = "chunk";
    const parts = chunkText(text, opts);
    if (!parts.length) throw new Error("no chunks produced");

    // 4) upsert в chunks. Политика source_id: URL
    stage = "db";
    const doc: IngestDoc = {
      ns,
      slot,
      source_id: url,       // единая политика: URL как source_id
      url,
      title: null,
      published_at: null,
      source_type: "pdf",
      kind,
      doc_metadata: {
        source_type: "pdf",
        url,
        page_count: pages ?? null,
        chunk: opts,
        chunk_total: parts.length,
      },
      chunks: parts.map((content, i) => ({
        content,
        chunk_no: i,
        metadata: {
          source_type: "pdf",
          url,
          page_count: pages ?? null,
          chunk: opts,
          chunk_chars: content.length,
        },
      })),
    };

    const { inserted, updated } = await upsertChunks([doc]);

    return NextResponse.json({
      ok: true,
      ns, slot, url,
      pages: pages ?? null,
      chunks: parts.length,
      textInserted: inserted,
      textUpdated: updated,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
