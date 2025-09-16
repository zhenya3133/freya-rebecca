// apps/web/src/app/api/ingest/github/route.ts
import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: string | null;
  kind?: string | null;
  owner: string;
  repo: string;
  ref?: string | null;          // branch or sha
  path?: string | null;         // optional subdir filter
  includeExt?: string[] | null; // e.g. [".md",".mdx",".py",".ipynb",".txt"]
  excludeExt?: string[] | null;
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

// мягкие лимиты, чтобы не взрывать embedding API
const MAX_FILES = 400;            // максимум файлов за один запрос
const MAX_FILE_BYTES = 1_000_000; // пропустить файлы > 1 МБ
const MAX_TOTAL_CHUNKS = 6000;    // общий лимит чанков на один вызов

async function gh<T = any>(url: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
  };
  const tok = (process.env.GITHUB_TOKEN || "").trim();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetch(url, { headers, redirect: "follow" });
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
    return cells
      .map((c: any) => (Array.isArray(c?.source) ? c.source.join("") : ""))
      .join("\n\n");
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const t0 = Date.now();
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
      chunk,
    } = (await req.json()) as Body;

    if (!ns || !owner || !repo) {
      return NextResponse.json({ ok: false, error: "ns, owner, repo required" }, { status: 400 });
    }

    // 1) определяем SHA
    let sha = "";
    try {
      const head = await gh<{ object: { sha: string } }>(
        `${GH}/repos/${owner}/${repo}/git/refs/heads/${ref}`
      );
      sha = head.object.sha;
    } catch {
      const anyRef = await gh<{ object: { sha: string } }>(
        `${GH}/repos/${owner}/${repo}/git/refs/${ref}`
      );
      sha = anyRef.object.sha;
    }

    // 2) дерево файлов
    const tree = await gh<{ tree: { path: string; type: string; sha: string }[] }>(
      `${GH}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
    );

    const files = tree.tree.filter(
      (t) => t.type === "blob" && (!path || t.path.startsWith(path))
    );

    const allow = (name: string) => {
      const e = extOf(name);
      if (includeExt && includeExt.length && !includeExt.includes(e)) return false;
      if (excludeExt && excludeExt.includes(e)) return false;
      // быстрый отсев известных бинарников
      if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz"].includes(e))
        return false;
      return true;
    };

    const selected = files.filter((f) => allow(f.path)).slice(0, MAX_FILES);

    // 3) тянем содержимое и чанк-ним
    const chunksAll: string[] = [];
    const metas: any[] = [];

    for (const f of selected) {
      // метаданные и размер файла
      const meta = await gh<{ size?: number; path: string }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${ref}`
      );

      if ((meta as any)?.size && (meta as any).size > MAX_FILE_BYTES) continue;

      // уже с контентом (тот же URL, GitHub вернёт base64)
      const raw = await gh<{ content: string; encoding: string; path: string; size?: number }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(f.path)}?ref=${ref}`
      );

      let text = "";
      if (raw.encoding === "base64") {
        const buf = Buffer.from(raw.content, "base64").toString("utf8");
        if (extOf(raw.path) === ".ipynb") {
          try {
            text = ipynbToText(JSON.parse(buf));
          } catch {
            text = "";
          }
        } else {
          text = buf;
        }
      }
      text = (text || "").trim();
      if (!text) continue;

      const opts = normalizeChunkOpts(chunk);
      const parts = chunkText(text, opts);

      for (const p of parts) {
        chunksAll.push(p);
        metas.push({
          source_type: "github",
          owner,
          repo,
          ref,
          path: raw.path,
          chunk_chars: p.length,
          chunk: opts,
        });
        if (chunksAll.length >= MAX_TOTAL_CHUNKS) break;
      }
      if (chunksAll.length >= MAX_TOTAL_CHUNKS) break;
    }

    if (!chunksAll.length) {
      return NextResponse.json(
        { ok: true, ns, slot, owner, repo, ref, files: selected.length, chunks: 0, written: 0, ms: Date.now() - t0 },
        { status: 200 }
      );
    }

    const vectors = await embedMany(chunksAll);
    const records = chunksAll.map((content, i) => ({
      kind: kind || "github",
      ns,
      slot,
      content,
      embedding: vectors[i],
      metadata: metas[i],
    }));
    const written: number = await upsertMemoriesBatch(records);

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      owner,
      repo,
      ref,
      files: selected.length,
      chunks: chunksAll.length,
      written,
            ms: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
