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

  dryRun?: boolean | null;      // только план без записи
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

    // 3) fetch + chunk (с ограничениями)
    stage = "fetch+chunk";
    const docs: IngestDoc[] = [];
    let totalChunks = 0;

    for (const p of pageFiles) {
      // метаданные (размер)
      const meta = await gh<{ size?: number; path: string }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${usedRef}`
      );
      if ((meta as any)?.size && (meta as any).size > MAX_FILE_BYTES) continue;

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
      if (!text) continue;

      const parts = chunkText(text, opts);
      if (!parts.length) continue;

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
          chunk: opts,
          chunk_total: parts.length,
        },
        chunks: parts.map((content, i) => ({
          content,
          chunk_no: i,
          metadata: {
            source_type: "github",
            owner, repo, ref: usedRef, path: raw.path,
            chunk: opts,
            chunk_chars: content.length,
          },
        })),
      };

      docs.push(doc);
      totalChunks += parts.length;
      if (totalChunks >= MAX_TOTAL_CHUNKS) break;
    }

    if (!docs.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: usedRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        textChunks: 0,
        textInserted: 0,
        textUpdated: 0,
        unchanged: 0,
        embedWritten: 0,
        nextCursor,
        ms: Date.now() - t0,
      });
    }

    // 4) upsert чанков с таргетами
    stage = "db-upsert";
    const { inserted, updated, targets, unchanged } = await upsertChunksWithTargets(docs);

    // 5) эмбеддинги только по target’ам (если не запретили)
    let embedWritten = 0;
    if (!skipEmbeddings && targets.length) {
      stage = "embed";
      const vectors = await embedMany(targets.map(t => t.content));
      stage = "db-embed";
      // батчево: один UPDATE per id
      // (простая петля; можно сделать bulk через UNNEST, но для простоты так)
      const { pool } = await import("@/lib/pg");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < targets.length; i++) {
          const id = targets[i].id;
          const v  = vectors[i];
          await client.query(`UPDATE chunks SET embedding = $1, updated_at = NOW() WHERE id = $2`, [v, id]);
          embedWritten += 1;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({
      ok: true,
      ns, slot, owner, repo, ref: usedRef,
      totalFiles,
      windowStart: cur,
      windowEnd: cur + pageFiles.length - 1,
      pageFiles: pageFiles.length,
      textChunks: totalChunks,
      textInserted: inserted,
      textUpdated: updated,
      unchanged,
      embedWritten,
      nextCursor,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}
