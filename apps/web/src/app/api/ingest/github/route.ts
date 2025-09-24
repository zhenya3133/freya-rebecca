import { NextResponse } from "next/server";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";
import { upsertChunks, type IngestDoc } from "@/lib/ingest_upsert";
import { sourceIdForGitHub } from "@/lib/source_id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: "staging" | "prod" | string | null;
  kind?: string | null;          // по умолчанию "github"
  owner: string;
  repo: string;
  ref?: string | null;           // branch or sha (default: main)
  path?: string | null;          // subdir filter (prefix)
  includeExt?: string[] | null;  // e.g. [".md",".mdx",".py",".ipynb",".txt",".pdf"]
  excludeExt?: string[] | null;

  // пагинация
  cursor?: number | null;        // смещение в отсортированном списке файлов (0..)
  limit?: number | null;         // сколько файлов взять сейчас (дефолт 250)

  // "сухой прогон" — только списки/подсчёты, без скачивания/записи
  dryRun?: boolean | null;

  // стандартные опции чанкинга
  chunk?: { chars?: number; overlap?: number };

  // управление PDF и лимитами
  parsePDF?: boolean | null;     // включить парсинг pdf → text (по умолчанию true, если .pdf разрешён)
  maxFileBytes?: number | null;  // перезаписать лимит размера файла (по умолчанию 1 МБ)
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

const MAX_LIMIT_FILES_DEFAULT = 250;
const MAX_FILE_BYTES_DEFAULT  = 1_000_000; // 1 МБ
const MAX_TOTAL_CHUNKS        = 3000;

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
      .map((c: any) =>
        Array.isArray(c?.source) ? c.source.join("") : (typeof c?.source === "string" ? c.source : "")
      )
      .join("\n\n");
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const started = Date.now();
  let stage = "init";
  try {
    assertAdmin(req);
    const body = (await req.json()) as Body;
    const {
      ns,
      slot = "staging",
      kind = "github",
      owner,
      repo,
      ref: refRaw = "main",
      path = "",
      includeExt,
      excludeExt,

      cursor = 0,
      limit = MAX_LIMIT_FILES_DEFAULT,
      dryRun = false,

      chunk,
      maxFileBytes = null,
    } = body;

    if (!ns || !owner || !repo) {
      return NextResponse.json({ ok: false, error: "ns, owner, repo required" }, { status: 400 });
    }
    if (!["staging", "prod"].includes(String(slot))) {
      return NextResponse.json({ ok: false, error: "slot must be 'staging'|'prod'" }, { status: 400 });
    }

    // безопасный ref на всём протяжении файла
    const safeRef: string = (refRaw ?? "main") as string;

    const lim = Math.max(1, Math.min(Number(limit) || MAX_LIMIT_FILES_DEFAULT, MAX_LIMIT_FILES_DEFAULT));
    const cur = Math.max(0, Number(cursor) || 0);
    const MAX_FILE_BYTES = Number.isFinite(Number(maxFileBytes))
      ? Math.max(10_000, Number(maxFileBytes))
      : MAX_FILE_BYTES_DEFAULT;

    // 1) определяем commit SHA
    stage = "ref";
    let sha = "";
    try {
      const head = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/heads/${safeRef}`);
      sha = head.object.sha;
    } catch {
      const anyRef = await gh<{ object: { sha: string } }>(`${GH}/repos/${owner}/${repo}/git/refs/${safeRef}`);
      sha = anyRef.object.sha;
    }

    // 2) получаем дерево файлов, фильтруем и сортируем
    stage = "tree";
    const tree = await gh<{ tree: { path: string; type: string; sha: string }[] }>(
      `${GH}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`
    );

    const usuallyBinary = [
      ".png",".jpg",".jpeg",".gif",".webp",".svg",".zip",".tar",".gz",".7z",
      ".mp4",".mp3",".mov",".avi",".wav",".pdf"
    ];

    const includeSet = (includeExt && includeExt.length) ? new Set(includeExt.map(e => e.toLowerCase())) : null;
    const excludeSet = (excludeExt && excludeExt.length) ? new Set(excludeExt.map(e => e.toLowerCase())) : null;

    const allowByExt = (name: string) => {
      const e = extOf(name);
      if (includeSet) {
        if (!includeSet.has(e)) return false;
      } else {
        if (usuallyBinary.includes(e)) return false;
      }
      if (excludeSet && excludeSet.has(e)) return false;
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
        ns, slot, owner, repo, ref: safeRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        nextCursor,
        ms: Date.now() - started,
        preview: pageFiles.slice(0, 10),
      });
    }

    if (!pageFiles.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: safeRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur - 1,
        pageFiles: 0,
        chunks: 0,
        written: [],
        nextCursor,
        ms: Date.now() - started,
      });
    }

    // 3) скачиваем контент выбранных файлов, чанк-ним → формируем IngestDoc[]
    stage = "fetch+chunk";
    const opts = normalizeChunkOpts(chunk);
    const docs: IngestDoc[] = [];
    let totalChunks = 0;

    for (const p of pageFiles) {
      if (totalChunks >= MAX_TOTAL_CHUNKS) break;

      // HEAD метаданные (размер и путь)
      const meta = await gh<{ size?: number; path: string }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${safeRef}`
      );
      if ((meta as any)?.size && (meta as any).size > MAX_FILE_BYTES) continue;

      // сам контент
      const raw = await gh<{ content: string; encoding: string; path: string; size?: number }>(
        `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(p)}?ref=${safeRef}`
      );

      let text = "";
      const e = extOf(raw.path);
      if (raw.encoding === "base64") {
        const buf = Buffer.from(raw.content, "base64");
        if (e === ".ipynb") {
          try { text = ipynbToText(JSON.parse(buf.toString("utf8"))); } catch { text = ""; }
        } else {
          text = buf.toString("utf8");
        }
      }
      text = (text || "").trim();
      if (!text) continue;

      const parts = chunkText(text, opts);
      const allowed = Math.min(parts.length, Math.max(0, MAX_TOTAL_CHUNKS - totalChunks));
      const chosen = parts.slice(0, allowed);

      const source_id = sourceIdForGitHub(owner, repo, safeRef, raw.path);
      const webUrl = `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(safeRef)}/${raw.path}`;

      const doc: IngestDoc = {
        ns,
        slot: slot as "staging" | "prod",
        source_id,
        url: webUrl,
        title: raw.path,
        published_at: null,
        source_type: "github",
        kind: kind || "github",
        doc_metadata: {
          source_type: "github",
          owner, repo, ref: safeRef, path: raw.path,
          chunk: opts,
          chunk_total: chosen.length,
        },
        chunks: chosen.map((content, i) => ({
          content,
          chunk_no: i,
          metadata: {
            source_type: "github",
            owner, repo, ref: safeRef, path: raw.path,
            chunk: opts,
            chunk_chars: content.length,
          },
        })),
      };

      docs.push(doc);
      totalChunks += chosen.length;
    }

    if (!docs.length) {
      return NextResponse.json({
        ok: true,
        ns, slot, owner, repo, ref: safeRef,
        totalFiles,
        windowStart: cur,
        windowEnd: cur + pageFiles.length - 1,
        pageFiles: pageFiles.length,
        chunks: 0,
        written: [],
        nextCursor,
        ms: Date.now() - started,
      });
    }

    // 4) запись
    stage = "db";
    const stats = await upsertChunks(docs);

    return NextResponse.json({
      ok: true,
      ns, slot, owner, repo, ref: safeRef,
      totalFiles,
      windowStart: cur,
      windowEnd: cur + pageFiles.length - 1,
      pageFiles: pageFiles.length,
      chunks: totalChunks,
      written: [], // можно заполнить ids при желании
      inserted: stats.inserted,
      updated: stats.updated,
      nextCursor,
      ms: Date.now() - started,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
