// apps/web/src/app/api/ingest/pdf/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunksWithTargets, type IngestDoc } from "@/lib/ingest_upsert";
import { embedMany } from "@/lib/embeddings";
import { pool } from "@/lib/pg";
import { retryFetch } from "@/lib/retryFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  url: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;                 // "pdf" по умолчанию
  chunk?: { chars?: number; overlap?: number };
  maxFileBytes?: number | null;         // лимит на размер PDF
  dryRun?: boolean;                     // только посчитать чанки, без записи в БД
  skipEmbeddings?: boolean;             // пропустить расчёт эмбеддингов
};

// user-agent пригодится для некоторых источников
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function importPdfParse(): Promise<(buf: Buffer) => Promise<any>> {
  const mod: any = await import("pdf-parse");
  const pdfParse = mod?.default ?? mod;
  return (buf: Buffer) => pdfParse(buf);
}

async function fetchAsBuffer(url: string, maxBytes?: number): Promise<Buffer> {
  if (url.startsWith("file://")) {
    const { readFile } = await import("node:fs/promises");
    return readFile(url.slice("file://".length));
  }
  const r = await retryFetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "application/pdf,*/*" } });
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.statusText}`);
  // если тело доступно стримом — читаем с лимитом
  const reader = r.body?.getReader();
  if (!reader) return Buffer.from(await r.arrayBuffer());
  const parts: Uint8Array[] = [];
  let total = 0, limit = Number(maxBytes) || Infinity;
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

// На случай, если pdf-parse не справился или источник капризный — Jina рендер
async function fetchPdfViaJina(url: string): Promise<string> {
  const enc = encodeURI(url).replace(/^https?:\/\//, "");
  const jina = `https://r.jina.ai/https://${enc}`;
  const r = await retryFetch(jina, { redirect: "follow", headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`Jina ${r.status} ${r.statusText}`);
  return await r.text();
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage: string = "init";
  try {
    assertAdmin(req);
    const body = (await req.json()) as Body;

    const ns   = (body.ns || "").trim();
    const url  = (body.url || "").trim();
    const slot = ((body.slot || "staging") as "staging" | "prod");
    const kind = (body.kind || "pdf");
    const opts = normalizeChunkOpts(body.chunk);
    const MAXB = Number.isFinite(Number(body.maxFileBytes)) ? Math.max(50_000, Number(body.maxFileBytes)) : undefined;
    const dryRun = !!body.dryRun;
    const skipEmb = !!body.skipEmbeddings;

    if (!ns || !url) {
      return NextResponse.json({ ok: false, stage, error: "ns and url are required" }, { status: 400 });
    }
    if (!["staging","prod"].includes(slot)) {
      return NextResponse.json({ ok: false, stage, error: "slot must be 'staging'|'prod'" }, { status: 400 });
    }

    stage = "download";
    let text = "";
    let pages: number | undefined;

    try {
      const buf = await fetchAsBuffer(url, MAXB);
      const pdfParse = await importPdfParse();
      stage = "pdf-parse";
      const out = await pdfParse(buf);
      text  = (out?.text || "").replace(/\s+/g, " ").trim();
      pages = out?.numpages;
    } catch {
      stage = "fallback-jina";
      text = (await fetchPdfViaJina(url)).replace(/\s+/g, " ").trim();
    }

    if (!text) {
      return NextResponse.json({
        ok: true, ns, slot, url, dryRun,
        pages: pages ?? null,
        textChunks: 0, textInserted: 0, textUpdated: 0, unchanged: 0, embedWritten: 0,
        ms: Date.now() - t0,
      });
    }

    stage = "chunk";
    const parts = chunkText(text, opts);
    const textChunks = parts.length;

    if (dryRun) {
      return NextResponse.json({
        ok: true, ns, slot, url, dryRun: true,
        pages: pages ?? null,
        textChunks, textInserted: 0, textUpdated: 0, unchanged: 0, embedWritten: 0,
        ms: Date.now() - t0,
      });
    }

    stage = "db-upsert";
    const doc: IngestDoc = {
      ns,
      slot,
      source_id: url,              // единая политика: source_id = URL
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

    const { inserted, updated, unchanged, targets } = await upsertChunksWithTargets([doc]);

    stage = "embeddings";
    let embedWritten = 0;
    if (!skipEmb && targets.length) {
      const contents = targets.map(t => t.content);
      const vectors  = await embedMany(contents); // проверяет EMBED_DIMS=1536
      for (let i = 0; i < targets.length; i++) {
        const id  = targets[i].id;
        const lit = toVectorLiteral(vectors[i]);
        await pool.query(`UPDATE chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`, [lit, id]);
        embedWritten += 1;
      }
    }

    return NextResponse.json({
      ok: true, ns, slot, url, dryRun: false,
      pages: pages ?? null,
      textChunks, textInserted: inserted, textUpdated: updated, unchanged, embedWritten,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage, error: e?.message || String(e) },
      { status: e?.message === "unauthorized" ? 401 : 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
