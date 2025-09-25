// apps/web/src/app/api/ingest/github/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { retryFetch } from "@/lib/retryFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: string | null;
  kind?: string | null;
  owner: string;
  repo: string;
  ref?: string | null;          // branch or sha
  path?: string | null;         // subdir filter (prefix)
  includeExt?: string[] | null; // e.g. [".md",".mdx",".py",".ipynb",".txt"]
  excludeExt?: string[] | null;

  // НОВОЕ: пагинация
  cursor?: number | null;       // смещение в отсортированном списке файлов (0..)
  limit?: number | null;        // сколько файлов взять сейчас (дефолт 250)

  // НОВОЕ: "сухой прогон" — только посчитать/список, без скачивания/эмбеддингов
  dryRun?: boolean | null;

  // стандартные опции чанкинга
  chunk?: { chars?: number; overlap?: number };
};

function assertAdmin(req: Request) {
  const need = (process.env.X_ADMIN_KEY || "").trim();
  if (!need) return;
  const got = (req.headers.get("x-admin-key") || "").trim();
  if (need && got !== need) throw new Error("unauthorized");
}

const GH = "https://api.github.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// мягкие лимиты на один ВЫЗОВ (страницу)
const MAX_LIMIT_FILES     = 250;     // максимум файлов за один вызов (страницу)
const MAX_FILE_BYTES      = 1_000_000; // пропускаем файлы >1 МБ
const MAX_TOTAL_CHUNKS    = 3000;    // общий лимит чанков на один вызов

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
    throw new Error(`GitHub ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
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
  const started = Date.now();
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

      chunk,
    } = (await req.json()) as Body;

    if (!ns || !owner || !repo) {
      return NextResponse.json({ ok: false, error: "ns, owner, repo required" }, { status: 400 });
    }
    const lim = Math.max(1, Math.min(Number(limit) || MAX_LIMIT_FILES, MAX_LIMIT_FILES));
    const cur = Math.max(0, Number(cursor) || 0);

    // 1) определяем commit SHA
    stage = "ref";
    let sha = "";
    try {
      const head = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/heads/${ref}`);
      sha = head.object.sha;
    } catch {
      const anyRef = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/${ref}`);
      sha = anyRef.object.sha;
    }

    // 2) получаем дерево файлов, фильтруем и сортируем
    stage = "tree";
    const tree = await gh<{ tree: { path: string; type: string; sha: string }[] }>(
      `${GH}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
    );

    const allowByExt = (name: string) => {
      const e = extOf(name);
      if (includeExt && includeExt.length && !includeExt.includes(e)) return false;
      if (excludeExt && excludeExt.includes(e)) return false;
      // базовый отсев бинарников/медиа
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
      // Ничего не скачиваем/не пишем — только план
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        nextCursor,
        ms: Date.now() - started,
        preview: pageFiles.slice(0, 10), // маленький список для наглядности
      });
    }

    if (!pageFiles.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref,
        totalFiles,
        windowStart: cur,
        windowEnd: cur - 1,
        pageFiles: 0,
        chunks: 0,
        written: 0,
        nextCursor,
        ms: Date.now() - started,
      });
    }

    // 3) скачиваем контент выбранных файлов и чанк-ним (с ограничениями)
    stage = "fetch+chunk";
    const chunksAll: string[] = [];
    const metas: any[] = [];
    const opts = normalizeChunkOpts(chunk);

    for (const p of pageFiles) {
      // метаданные и размер
      const meta = await gh<{ size?: number; path: string }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${ref}`
      );
      if ((meta as any)?.size && (meta as any).size > MAX_FILE_BYTES) continue;

      const raw = await gh<{ content: string; encoding: string; path: string; size?: number }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${ref}`
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
      for (const part of parts) {
        chunksAll.push(part);
        metas.push({
          source_type: "github",
          owner, repo, ref, path: raw.path,
          chunk: opts,
          chunk_chars: part.length,
        });
        if (chunksAll.length >= MAX_TOTAL_CHUNKS) break;
      }
      if (chunksAll.length >= MAX_TOTAL_CHUNKS) break;
    }

    if (!chunksAll.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        chunks: 0,
        written: 0,
        nextCursor,
        ms: Date.now() - started,
      });
    }

    // 4) эмбеддинги и запись
    stage = "embed";
    const vectors = await embedMany(chunksAll);

    stage = "db";
    const records = chunksAll.map((content, i) => ({
      kind: kind || "github",
      ns, slot,
      content,
      embedding: vectors[i],
      metadata: metas[i],
    }));

    // Важно: у тебя upsertMemoriesBatch возвращает number (сколько записей сделано)
    const written: number = await upsertMemoriesBatch(records);

    return NextResponse.json({
      ok: true,
      ns, slot, owner, repo, ref,
      totalFiles,
      windowStart: cur,
      windowEnd: cur + pageFiles.length - 1,
      pageFiles: pageFiles.length,
      chunks: chunksAll.length,
      written,
      nextCursor,
      ms: Date.now() - started,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}
