// apps/web/src/app/api/ingest/github-archive/route.ts
import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/admin";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunksWithTargets, type IngestDoc } from "@/lib/ingest_upsert";
import { embedMany } from "@/lib/embeddings";
import { pool } from "@/lib/pg";

import * as tar from "tar";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | (string & {});
  kind?: string | null;

  owner: string;
  repo: string;
  ref?: string | null;

  includeExt?: string[] | null;
  excludeExt?: string[] | null;

  dryRun?: boolean | null;
  skipEmbeddings?: boolean | null;

  chunk?: { chars?: number; overlap?: number };
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// мягкие лимиты и параметры
const MAX_FILE_BYTES = 1_000_000;     // 1 MB/файл
const MAX_TOTAL_CHUNKS = 3000;        // не перегружаем страницу инжеста
const EMBED_BATCH = Number(process.env.INGEST_EMBED_BATCH || 128);

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function allowByExt(name: string, allow?: string[] | null, deny?: string[] | null) {
  const e = extOf(name);
  if (allow && allow.length && !allow.includes(e)) return false;
  if (deny && deny.includes(e)) return false;
  // явные бинарники
  if ([".png",".jpg",".jpeg",".gif",".webp",".svg",".pdf",".zip",".tar",".gz",".7z",".mp4",".mp3",".woff",".woff2"].includes(e)) return false;
  return true;
}

// 🧼 удаляем \u0000 и агрессивно чистим управляющие символы
function sanitizeText(s: string): string {
  if (!s) return "";
  // убрать нулевой байт (главное для Postgres)
  s = s.replace(/\u0000/g, " ");
  // нормализуем перевод строк и прибираем экзотические control-ы, кроме \n\t
  s = s.replace(/\r/g, "\n").replace(/[^\S\n\t]+/g, " ");
  // мягко уберём прочие C0/C1 controls кроме \n\t
  s = s.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
  // схлопнем множественные пробелы
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage: string = "init";
  try {
    assertAdmin(req);

    const {
      ns,
      slot = "staging",
      kind = "github",
      owner,
      repo,
      ref = "main",
      includeExt,
      excludeExt,
      dryRun = false,
      skipEmbeddings = false,
      chunk,
    } = (await req.json()) as Body;

    if (!ns || !owner || !repo) {
      return NextResponse.json({ ok: false, stage, error: "ns, owner, repo required" }, { status: 400 });
    }
    if (!["staging","prod"].includes(String(slot))) {
      return NextResponse.json({ ok: false, stage, error: "slot must be 'staging'|'prod'" }, { status: 400 });
    }
    const opts = normalizeChunkOpts(chunk);

    // 1) качаем tar.gz из codeload (почти без rate-limit)
    stage = "download";
    const tarUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(ref ?? "main")}`;
    const res = await fetch(tarUrl, { headers: { "User-Agent": UA, Accept: "application/x-gzip,*/*" }, redirect: "follow" as any });
    if (!res.ok || !res.body) {
      throw new Error(`codeload ${res.status} ${res.statusText}`);
    }
    const nodeStream = Readable.fromWeb(res.body as any);

    // 2) распаковываем и собираем docs
    stage = "unpack+chunk";
    const docs: IngestDoc[] = [];
    let producedChunks = 0;

    await new Promise<void>((resolve, reject) => {
      const parser = tar.t({
        onentry: (entry) => {
          try {
            if (entry.type !== "File") { entry.resume(); return; }

            // в архиве пути вида: "<repo>-<sha>/path/to/file"
            const parts = entry.path.split("/").slice(1);
            const relPath = parts.join("/");
            if (!relPath) { entry.resume(); return; }

            if (!allowByExt(relPath, includeExt, excludeExt)) { entry.resume(); return; }

            // лимит файла
            let size = 0;
            const bufs: Buffer[] = [];
            entry.on("data", (b: Buffer) => {
              size += b.length;
              if (size <= MAX_FILE_BYTES) bufs.push(b);
            });
            entry.on("end", () => {
              if (size > MAX_FILE_BYTES) return;

              let text = Buffer.concat(bufs).toString("utf8");
              text = sanitizeText(text);
              if (!text) return;

              const chunks = chunkText(text, opts);
              if (!chunks.length) return;

              // лимит общего числа чанков на запрос
              let use = chunks;
              if (producedChunks + chunks.length > MAX_TOTAL_CHUNKS) {
                const rest = MAX_TOTAL_CHUNKS - producedChunks;
                if (rest <= 0) return;
                use = chunks.slice(0, rest);
              }

              const sourceUrl = `https://github.com/${owner}/${repo}/blob/${ref}/${relPath}`;
              const sourceId  = `github:${owner}/${repo}@${ref}:${relPath}`;

              docs.push({
                ns,
                slot,
                source_id: sourceId,
                url: sourceUrl,
                title: null,
                published_at: null,
                source_type: "github-archive",
                kind,
                doc_metadata: {
                  source_type: "github-archive",
                  owner, repo, ref, path: relPath,
                  chunk: opts,
                  chunk_total: use.length,
                },
                chunks: use.map((content, i) => ({
                  content: sanitizeText(content), // 🧼 на всякий
                  chunk_no: i,
                  metadata: {
                    source_type: "github-archive",
                    owner, repo, ref, path: relPath,
                    chunk: opts,
                    chunk_chars: content.length,
                  },
                })),
              } as IngestDoc);

              producedChunks += use.length;
            });
          } catch (e) {
            entry.resume();
            reject(e);
          }
        },
      });

      parser.on("error", reject);
      parser.on("close", resolve);
      nodeStream.pipe(parser);
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true, ns, slot, owner, repo, ref,
        textChunks: producedChunks, textInserted: 0, textUpdated: 0, unchanged: 0, embedWritten: 0,
        ms: Date.now() - t0,
      });
    }

    // 3) upsert
    stage = "db-upsert";
    const { inserted, updated, unchanged, targets } = docs.length
      ? await upsertChunksWithTargets(docs)
      : { inserted: 0, updated: 0, unchanged: 0, targets: [] as { id: string; content: string }[] };

    // 4) эмбеддинги (опционально)
    stage = "embeddings";
    let embedWritten = 0;
    if (!skipEmbeddings && targets.length) {
      const vectors = await embedMany(targets.map(t => t.content));
      for (let i = 0; i < targets.length; i++) {
        const id = targets[i].id;
        const lit = toVectorLiteral(vectors[i]);
        await pool.query(`UPDATE chunks SET embedding = $1::vector, updated_at = NOW() WHERE id = $2`, [lit, id]);
        embedWritten += 1;
      }
    }

    return NextResponse.json({
      ok: true, ns, slot, owner, repo, ref,
      textChunks: producedChunks,
      textInserted: inserted, textUpdated: updated, unchanged, embedWritten,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}
