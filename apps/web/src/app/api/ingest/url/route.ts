import { NextResponse } from "next/server";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunks, type IngestDoc } from "@/lib/ingest_upsert";
import { retryFetch } from "@/lib/retryFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;                 // "url" по умолчанию
  urls: string[];
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

async function fetchTextOrPdf(url: string): Promise<{ type: "text" | "pdf"; text?: string; buf?: Buffer; ctype?: string }> {
  const r = await retryFetch(url, { redirect: "follow", headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${r.statusText}`);
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
    const ab = await r.arrayBuffer();
    return { type: "pdf", buf: Buffer.from(ab), ctype: ct };
  }
  return { type: "text", text: await r.text(), ctype: ct };
}

// очень простой «выколачиватель» текста из HTML (нам хватает)
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage: string | null = null;
  try {
    assertAdmin(req);
    stage = "init";
    const body = (await req.json()) as Body;

    const ns   = (body.ns || "").trim();
    const slot = ((body.slot || "staging") as "staging" | "prod");
    const kind = (body.kind || "url");
    const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
    const opts = normalizeChunkOpts(body.chunk);

    if (!ns || !urls.length) {
      return NextResponse.json({ ok: false, error: "ns and urls are required" }, { status: 400 });
    }
    if (!["staging", "prod"].includes(slot)) {
      return NextResponse.json({ ok: false, error: "slot must be 'staging'|'prod'" }, { status: 400 });
    }

    let textInserted = 0;
    let textUpdated  = 0;
    let textChunks   = 0;

    // соберём документы, а PDF — делегируем в /api/ingest/pdf
    const docs: IngestDoc[] = [];
    const pdfQueue: { url: string }[] = [];

    stage = "fetch";
    for (const url of urls) {
      try {
        const res = await fetchTextOrPdf(url);
        if (res.type === "pdf") {
          pdfQueue.push({ url });
          continue;
        }
        const txt = htmlToText(res.text || "");
        if (!txt) continue;

        const parts = chunkText(txt, opts);
        textChunks += parts.length;

        const doc: IngestDoc = {
          ns,
          slot,
          source_id: url,              // единая политика: source_id = URL
          url,
          title: null,
          published_at: null,
          source_type: "url",
          kind,
          doc_metadata: {
            source_type: "url",
            url,
            chunk: opts,
            chunk_total: parts.length,
          },
          chunks: parts.map((content, i) => ({
            content,
            chunk_no: i,
            metadata: {
              source_type: "url",
              url,
              chunk: opts,
              chunk_chars: content.length,
            },
          })),
        };
        docs.push(doc);
      } catch (e) {
        // копим ошибки на сторону клиента
        console.warn("ingest/url: failed", url, String(e));
      }
    }

    stage = "db";
    if (docs.length) {
      const r = await upsertChunks(docs);
      textInserted += r.inserted;
      textUpdated  += r.updated;
    }

    // PDF делегируем (последовательно — чтобы не спамить)
    stage = "delegate-pdf";
    let pdfDelegated = 0;
    let pdfStats = { chunks: 0, written: 0 };
    for (const p of pdfQueue) {
      pdfDelegated++;
      try {
        const resp = await retryFetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/ingest/pdf`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-key": req.headers.get("x-admin-key") || "",
          },
          body: JSON.stringify({ ns, slot, url: p.url, kind: "pdf", chunk: opts }),
        });
        // мы не проваливаемся по ошибке; просто статистика
        const j = await resp.json().catch(() => ({}));
        if (j?.chunks) pdfStats.chunks += Number(j.chunks) || 0;
        if (j?.textInserted) pdfStats.written += Number(j.textInserted) || 0;
      } catch (e) {
        console.warn("delegate pdf failed:", p.url, String(e));
      }
    }

    return NextResponse.json({
      ok: true,
      ns, slot, urls,
      pdfDelegated,
      pdfStats,
      textChunks,
      textInserted,
      textUpdated,
      failures: [],
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
