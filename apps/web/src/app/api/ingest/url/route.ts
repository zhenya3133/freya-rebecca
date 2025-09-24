import { NextResponse } from "next/server";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunks, type IngestDoc } from "@/lib/ingest_upsert";
import { sourceIdForUrl } from "@/lib/source_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  urls: string[];
  kind?: string | null; // default: "url"
  chunk?: { chars?: number; overlap?: number } | null;
};

function assertAdmin(req: Request) {
  const need = (process.env.X_ADMIN_KEY || "").trim();
  if (!need) return;
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (need && got !== need) throw new Error("unauthorized");
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  // Только текст/HTML берём здесь. Для PDF есть отдельный /ingest/pdf
  if (ct.includes("pdf")) {
    throw new Error("got PDF (use /api/ingest/pdf)");
  }
  const html = await res.text();
  return htmlToPlain(html);
}

function htmlToPlain(html: string): string {
  try {
    let s = html;
    // вырезаем <script>/<style>
    s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
    s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
    // теги в пробел
    s = s.replace(/<[^>]+>/g, " ");
    // декод простых сущностей
    s = s
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    // нормализация пробелов
    s = s.replace(/\s+/g, " ").trim();
    return s;
  } catch {
    return html;
  }
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  try {
    assertAdmin(req);
    const body = (await req.json()) as Body;
    const ns = (body.ns || "").trim();
    const slot = (body.slot || "staging").trim() as "staging" | "prod";
    const urls = Array.isArray(body.urls) ? body.urls.map(String) : [];
    const kind = (body.kind || "url").trim();
    const chunk = body.chunk || undefined;

    if (!ns || !urls.length) {
      return NextResponse.json(
        { ok: false, error: "ns and urls are required" },
        { status: 400 }
      );
    }
    if (!["staging", "prod"].includes(slot)) {
      return NextResponse.json(
        { ok: false, error: "slot must be 'staging'|'prod'" },
        { status: 400 }
      );
    }

    stage = "fetch+chunk";
    const opts = normalizeChunkOpts(chunk);
    const docs: IngestDoc[] = [];
    const failures: { url: string; error: string }[] = [];
    let textChunks = 0;

    for (const url of urls) {
      try {
        const text = await fetchText(url);
        if (!text) continue;
        const parts = chunkText(text, opts);
        textChunks += parts.length;

        const doc: IngestDoc = {
          ns,
          slot,
          url,
          title: url,
          source_id: sourceIdForUrl(url),
          source_type: "url",
          kind,
          published_at: null,
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
      } catch (e: any) {
        failures.push({ url, error: e?.message || String(e) });
      }
    }

    if (!docs.length) {
      return NextResponse.json({
        ok: true,
        textChunks,
        textInserted: 0,
        textUpdated: 0,
        failures,
        ms: Date.now() - t0,
      });
    }

    stage = "db";
    const stats = await upsertChunks(docs);

    return NextResponse.json({
      ok: true,
      textChunks,
      textInserted: stats.inserted,
      textUpdated: stats.updated,
      failures,
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
