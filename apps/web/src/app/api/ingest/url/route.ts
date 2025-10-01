// apps/web/src/app/api/ingest/url/route.ts
import { NextResponse } from "next/server";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunksWithTargets, type IngestDoc } from "@/lib/ingest_upsert";
import { retryFetch } from "@/lib/retryFetch";
import { assertAdmin } from "@/lib/admin";
import { embedMany } from "@/lib/embeddings";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;
  urls: string[];
  chunk?: { chars?: number; overlap?: number };
  dryRun?: boolean;
  skipEmbeddings?: boolean;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchTextOrPdf(
  url: string
): Promise<{ type: "text" | "pdf"; text?: string; buf?: Buffer; ctype?: string }> {
  const r = await retryFetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "*/*" },
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${r.statusText}`);
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
    const ab = await r.arrayBuffer();
    return { type: "pdf", buf: Buffer.from(ab), ctype: ct };
  }
  return { type: "text", text: await r.text(), ctype: ct };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage: string | null = null;

  try {
    assertAdmin(req);

    stage = "init";
    const body = (await req.json()) as Body;

    const ns = (body.ns || "").trim();
    const slot = (body.slot || "staging") as "staging" | "prod";
    const kind = (body.kind || "url") as string;
    const urls = Array.isArray(body.urls) ? body.urls.filter(Boolean) : [];
    const opts = normalizeChunkOpts(body.chunk);
    const dryRun = !!body.dryRun;
    const skipEmb = !!body.skipEmbeddings;

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

    let textInserted = 0;
    let textUpdated = 0;
    let textChunks = 0;
    let embedWritten = 0;
    let unchanged = 0;

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
          source_id: url,
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
        // не фейлим весь батч — просто логируем
        console.warn("ingest/url: failed", url, String(e));
      }
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ns,
        slot,
        urls,
        dryRun: true,
        pdfDelegated: 0,
        pdfStats: { chunks: 0, written: 0 },
        textChunks,
        textInserted: 0,
        textUpdated: 0,
        unchanged: 0,
        embedWritten: 0,
        ms: Date.now() - t0,
      });
    }

    stage = "db-upsert";
    let targets: Array<{ id: string; content: string }> = [];
    if (docs.length) {
      const r = await upsertChunksWithTargets(docs);
      textInserted += r.inserted;
      textUpdated += r.updated;
      unchanged += r.unchanged;
      targets = r.targets;
    }

    stage = "embeddings";
    if (!skipEmb && targets.length) {
      const contents = targets.map((t) => t.content);
      const vectors = await embedMany(contents); // проверит DIMS=1536

      // Пакетный UPDATE: приводим id к bigint и обновляем разом
      const ids: number[] = targets.map((t) => Number(t.id));
      const vecs: string[] = vectors.map((v) => {
        const arr = Array.isArray((v as any)?.embedding)
          ? ((v as any).embedding as number[])
          : (v as number[]);
        return toVectorLiteral(arr);
      });

      await pool.query("BEGIN");
      try {
        await pool.query(
          `
          WITH data AS (
            SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::text[]) AS vec
          )
          UPDATE chunks c
          SET embedding = data.vec::vector, updated_at = NOW()
          FROM data
          WHERE c.id = data.id
          `,
          [ids, vecs]
        );
        await pool.query("COMMIT");
        embedWritten = ids.length;
      } catch (e) {
        await pool.query("ROLLBACK");
        throw e;
      }
    }

    stage = "delegate-pdf";
    let pdfDelegated = 0;
    let pdfStats = { chunks: 0, written: 0 };
    for (const p of pdfQueue) {
      pdfDelegated++;
      try {
        const resp = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/ingest/pdf`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-admin-key": req.headers.get("x-admin-key") || "",
            },
            body: JSON.stringify({
              ns,
              slot,
              url: p.url,
              kind: "pdf",
              chunk: opts,
            }),
          }
        );
        const j = await resp.json().catch(() => ({} as any));
        if (j?.chunks) pdfStats.chunks += Number(j.chunks) || 0;
        if (j?.textInserted) pdfStats.written += Number(j.textInserted) || 0;
      } catch (e) {
        console.warn("delegate pdf failed:", p.url, String(e));
      }
    }

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      urls,
      dryRun: false,
      skipEmbeddings: skipEmb,
      pdfDelegated,
      pdfStats,
      textChunks,
      textInserted,
      textUpdated,
      unchanged,
      embedWritten,
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
