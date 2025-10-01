// apps/web/src/app/api/ingest/github/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { retryFetch } from "@/lib/retryFetch";
import { assertAdmin } from "@/lib/admin";
import { upsertChunksWithTargets, type IngestDoc } from "@/lib/ingest_upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;

  owner: string;
  repo: string;
  ref?: string | null;          // branch / tag / sha
  path?: string | null;         // префикс каталога (фильтр)
  includeExt?: string[] | null; // например [".md",".mdx",".py",".ipynb",".txt"]
  excludeExt?: string[] | null; // что исключить

  cursor?: number | null;       // смещение
  limit?: number | null;        // кол-во файлов на страницу (<= 250)

  dryRun?: boolean | null;         // только план без записи
  skipEmbeddings?: boolean | null; // не считать эмбеддинги (для последующего backfill)

  chunk?: { chars?: number; overlap?: number };
};

const GH = "https://api.github.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// мягкие лимиты на вызов
const MAX_LIMIT_FILES  = 250;
const MAX_FILE_BYTES   = 1_000_000;
const MAX_TOTAL_CHUNKS = 3000;

// Параллелизм и батчи — можно крутить под свой кластер
const FETCH_CONCURRENCY = Number(process.env.INGEST_FETCH_CONCURRENCY || 6);   // параллельных fetch к GitHub
const EMBED_BATCH       = Number(process.env.INGEST_EMBED_BATCH || 128);       // документов на один вызов embedMany
const BACKFILL_LIMIT    = Number(process.env.INGEST_BACKFILL_LIMIT || 5000);   // лимит на backfill NULL-эмбеддингов/страница

async function gh<T = any>(url: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
  };
  const tok = (process.env.GITHUB_TOKEN || "").trim();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await retryFetch(url, { headers, redirect: "follow" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} ${res.statusText}: ${text.slice(0,300)}`);
  }
  return (await res.json()) as T;
}

async function resolveSha(owner: string, repo: string, ref?: string | null): Promise<{ sha: string; usedRef: string }> {
  const want = (ref || "").trim();

  // пусто → default_branch
  if (!want) {
    const info = await gh<{ default_branch: string }>(`${GH}/repos/${owner}/${repo}`);
    const def = info.default_branch || "master";
    const head = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/heads/${def}`);
    return { sha: head.object.sha, usedRef: def };
  }

  // heads/<ref>
  try {
    const head = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/heads/${want}`);
    return { sha: head.object.sha, usedRef: want };
  } catch {}

  // tags/<ref>
  try {
    const tag = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/tags/${want}`);
    return { sha: tag.object.sha, usedRef: want };
  } catch {}

  // refs/<ref>
  try {
    const anyRef = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/${want}`);
    return { sha: anyRef.object.sha, usedRef: want };
  } catch {}

  // уже sha?
  if (/^[0-9a-f]{7,40}$/i.test(want)) return { sha: want, usedRef: want };

  // fallback → default_branch
  const info = await gh<{ default_branch: string }>(`${GH}/repos/${owner}/${repo}`);
  const def = info.default_branch || "master";
  const head = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/heads/${def}`);
  return { sha: head.object.sha, usedRef: def };
}

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function ipynbToText(nb: any): string {
  try {
    const cells = Array.isArray(nb?.cells) ? nb.cells : [];
    return cells.map((c: any) => (Array.isArray(c?.source) ? c.source.join("") : "")).join("\n\n");
  } catch {
    return "";
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function uniqBy<T, K>(arr: T[], key: (x: T) => K): T[] {
  const seen = new Set<K>();
  const out: T[] = [];
  for (const x of arr) { const k = key(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

async function mapWithConcurrency<I, O>(
  items: I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>
): Promise<O[]> {
  if (limit <= 1) {
    const out: O[] = [];
    for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
    return out;
  }
  const results: O[] = new Array(items.length) as any;
  let i = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  try {
    assertAdmin(req);

    const {
      ns,
      slot = "staging",
      kind = "github",
      owner,
      repo,
      ref = "main",
      path = "",
      includeExt,
      excludeExt,
      cursor = 0,
      limit = MAX_LIMIT_FILES,
      dryRun = false,
      skipEmbeddings = false,
      chunk,
    } = (await req.json()) as Body;

    if (!ns || !owner || !repo) {
      return NextResponse.json({ ok: false, stage, error: "ns, owner, repo required" }, { status: 400 });
    }
    const lim = Math.max(1, Math.min(Number(limit) || MAX_LIMIT_FILES, MAX_LIMIT_FILES));
    const cur = Math.max(0, Number(cursor) || 0);
    const opts = normalizeChunkOpts(chunk);

    // 1) ref → sha
    stage = "ref";
    const { sha, usedRef } = await resolveSha(owner, repo, ref);

    // 2) дерево + фильтры
    stage = "tree";
    const tree = await gh<{ tree: { path: string; type: string; sha: string }[] }>(
      `${GH}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
    );

    // карта blobSha по пути
    const blobShaByPath = new Map<string,string>();
    for (const t of tree.tree) {
      if (t.type === "blob") blobShaByPath.set(t.path, t.sha);
    }

    const allowByExt = (name: string) => {
      const e = extOf(name);
      if (includeExt && includeExt.length && !includeExt.includes(e)) return false;
      if (excludeExt && excludeExt.includes(e)) return false;
      if ([".png",".jpg",".jpeg",".gif",".webp",".svg",".pdf",".zip",".tar",".gz",".7z",".mp4",".mp3"].includes(e)) return false;
      return true;
    };

    const allFiles = tree.tree
      .filter((t) => t.type === "blob" && (!path || t.path.startsWith(path)))
      .map((t) => t.path)
      .filter(allowByExt)
      .sort((a, b) => a.localeCompare(b));

    const totalFiles = allFiles.length;
    const pageFiles = allFiles.slice(cur, cur + lim);
    const nextCursor = cur + pageFiles.length < totalFiles ? cur + pageFiles.length : null;

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: usedRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        nextCursor,
        ms: Date.now() - t0,
        preview: pageFiles.slice(0, 10),
      });
    }

    if (!pageFiles.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: usedRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur - 1,
        pageFiles: 0,
        textChunks: 0,
        textInserted: 0,
        textUpdated: 0,
        unchanged: 0,
        embedWritten: 0,
        nextCursor,
        ms: Date.now() - t0,
      });
    }

    // 3) fetch + chunk (с ограничениями) + SKIP по blob_sha + ПАРАЛЛЕЛИЗМ
    stage = "fetch+chunk";
    const docs: IngestDoc[] = [];
    let producedChunks = 0;

    const { pool } = await import("@/lib/pg");
    const client = await pool.connect();

    // sourceIds всей страницы — понадобятся для бэкофилла эмбеддингов даже при skip-fetch
    const sourceIdsPage: string[] = pageFiles.map((p) => `github:${owner}/${repo}@${usedRef}:${p}`);

    try {
      // Обрабатываем файлы параллельно с лимитом FETCH_CONCURRENCY
      const perFile = await mapWithConcurrency(pageFiles, FETCH_CONCURRENCY, async (p) => {
        const blobSha = blobShaByPath.get(p) || null;

        // если в БД уже есть чанки с таким же blob_sha — пропускаем скачивание
        if (blobSha) {
          const check = await client.query<{ exists: boolean }>(
            `
            SELECT EXISTS (
              SELECT 1
              FROM chunks
              WHERE source_id = $1
                AND (metadata->>'blob_sha') = $2
              LIMIT 1
            ) AS exists
            `,
            [`github:${owner}/${repo}@${usedRef}:${p}`, blobSha]
          );
          if (check.rows[0]?.exists) {
            return { doc: null as IngestDoc | null, chunks: 0 };
          }
        }

        // метаданные (размер)
        const meta = await gh<{ size?: number; path: string }>(
          `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${usedRef}`
        );
        if ((meta as any)?.size && (meta as any).size > MAX_FILE_BYTES) {
          return { doc: null, chunks: 0 };
        }

        const raw = await gh<{ content: string; encoding: string; path: string; size?: number }>(
          `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${usedRef}`
        );

        let text = "";
        if (raw.encoding === "base64") {
          const buf = Buffer.from(raw.content, "base64").toString("utf8");
          if (extOf(raw.path) === ".ipynb") {
            try { text = ipynbToText(JSON.parse(buf)); } catch { text = ""; }
          } else {
            text = buf;
          }
        }
        text = (text || "").trim();
        if (!text) return { doc: null, chunks: 0 };

        const parts = chunkText(text, opts);
        if (!parts.length) return { doc: null, chunks: 0 };

        const sourceUrl = `https://github.com/${owner}/${repo}/blob/${usedRef}/${raw.path}`;
        const sourceId  = `github:${owner}/${repo}@${usedRef}:${raw.path}`;

        const doc: IngestDoc = {
          ns,
          slot,
          source_id: sourceId,
          url: sourceUrl,
          title: null,
          published_at: null,
          source_type: "github",
          kind: kind || "github",
          doc_metadata: {
            source_type: "github",
            owner, repo, ref: usedRef, path: raw.path,
            blob_sha: blobSha || null,
            chunk: opts,
            chunk_total: parts.length,
          },
          chunks: parts.map((content, i) => ({
            content,
            chunk_no: i,
            metadata: {
              source_type: "github",
              owner, repo, ref: usedRef, path: raw.path,
              blob_sha: blobSha || null,
              chunk: opts,
              chunk_chars: content.length,
            },
          })),
        };

        return { doc, chunks: parts.length };
      });

      // Собираем результаты, ограничиваем по MAX_TOTAL_CHUNKS
      for (const r of perFile) {
        if (!r?.doc) continue;
        if (producedChunks + r.chunks > MAX_TOTAL_CHUNKS) {
          const rest = MAX_TOTAL_CHUNKS - producedChunks;
          if (rest <= 0) break;
          const slim: IngestDoc = {
            ...r.doc,
            doc_metadata: { ...(r.doc.doc_metadata || {}), chunk_total: rest },
            chunks: r.doc.chunks.slice(0, rest),
          };
          docs.push(slim);
          producedChunks += rest;
          break;
        } else {
          docs.push(r.doc);
          producedChunks += r.chunks;
        }
      }

      // 4) upsert чанков с таргетами
      stage = "db-upsert";
      const { inserted, updated, targets, unchanged } = docs.length
        ? await upsertChunksWithTargets(docs)
        : { inserted: 0, updated: 0, targets: [] as {id: string, content: string}[], unchanged: 0 };

      // 5) эмбеддинги (включая бэкофилл для embedding IS NULL) + БАТЧИ + Пакетный UPDATE
      let embedWritten = 0;
      if (!skipEmbeddings) {
        stage = "embed+backfill";

        type TargetRow = { id: string; content: string };
        const targetRowsRaw: TargetRow[] = [];

        // (а) изменившиеся/новые
        for (const t of targets) targetRowsRaw.push({ id: t.id, content: t.content });

        // (б) бэкофилл: null-эмбеддинги по всем source_id страницы
        if (sourceIdsPage.length) {
          const r = await client.query<TargetRow>(
            `
            SELECT id, content
            FROM chunks
            WHERE embedding IS NULL
              AND source_id = ANY($1)
            LIMIT $2
            `,
            [sourceIdsPage, BACKFILL_LIMIT]
          );
          targetRowsRaw.push(...r.rows);
        }

        // dedup по id
        const targetRows = uniqBy(targetRowsRaw, x => x.id);

        const batches = chunkArray(targetRows, EMBED_BATCH);

        for (const batch of batches) {
          if (!batch.length) continue;

          stage = "embed";
          const vectorsRaw = await embedMany(batch.map((t) => t.content));
          if (!Array.isArray(vectorsRaw) || vectorsRaw.length !== batch.length) {
            throw new Error(`embedMany mismatch: got ${Array.isArray(vectorsRaw) ? vectorsRaw.length : -1} for ${batch.length}`);
          }

          // → строка вида "[0.1,-0.2,...]" без пробелов
          const toPgVector = (v: any): string => {
            const arr: number[] = Array.isArray(v)
              ? v.map((x) => Number(x))
              : Array.isArray((v as any)?.embedding)
              ? (v as any).embedding.map((x: any) => Number(x))
              : [];
            if (!arr.length) throw new Error("Empty embedding vector");
            return `[${arr.join(",")}]`;
          };

          const ids: number[] = [];
          const vecs: string[] = [];
          for (let i = 0; i < batch.length; i++) {
            ids.push(Number(batch[i].id));               // ВАЖНО: числа, не строки
            vecs.push(toPgVector((vectorsRaw as any)[i]));
          }

          // Пакетный апдейт одним запросом; id → bigint[]
          stage = "db-embed";
          await client.query("BEGIN");
          try {
            await client.query(
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
            await client.query("COMMIT");
            embedWritten += ids.length;
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
        }
      }

      // успех
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: usedRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        textChunks: producedChunks,
        textInserted: inserted,
        textUpdated: updated,
        unchanged,
        embedWritten,
        nextCursor,
        ms: Date.now() - t0,
      });
    } finally {
      // гарантированно освобождаем подключение
      try { (await import("@/lib/pg")).pool; } catch {}
      // client объявлен выше; проверяем что он существует
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const _any: any = null;
      try {
        // @ts-expect-error runtime check
        if (typeof (client as any)?.release === "function") (client as any).release();
      } catch {}
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}
