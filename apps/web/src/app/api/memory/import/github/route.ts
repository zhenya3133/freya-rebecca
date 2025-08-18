// apps/web/src/app/api/memory/import/github/route.ts
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";

export const runtime = "nodejs";

type Body = {
  ns?: string;                // неймспейс (по умолчанию "rebecca")
  url?: string;               // https://github.com/owner/repo  (можно вместо owner/repo)
  owner?: string;             // альтернативно: owner + repo
  repo?: string;
  branch?: string;            // по умолчанию "main"
  maxFiles?: number;          // лимит файлов (например, 120)
  maxSizeKB?: number;         // максимальный размер файла (например, 150 КБ)
  includeExt?: string[];      // список расширений для включения
  excludeDirs?: string[];     // директории-исключения
  chunk?: { size?: number; overlap?: number };
  metadata?: Record<string, unknown>; // базовые метаданные
};

const DEFAULT_EXT = [
  ".md",".txt",".rst",".tex",
  ".py",".ts",".tsx",".js",".jsx",
  ".json",".yml",".yaml",".toml",".ini",
  ".go",".rs",".java",".kt",".c",".h",".cpp",".hpp",".cs",
  ".sh",".bash",".ps1",".sql"
];
const DEFAULT_EXCLUDE = ["node_modules","dist","build",".next",".git","vendor",".venv",".idea",".vscode","out"];

export async function POST(req: Request) {
  try {
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL not set");
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY not set");

    const body = (await req.json().catch(() => ({}))) as Body;

    // ЕДИНЫЕ ПРАВИЛА: всегда задаём ns и кладём его в metadata
    const ns = (body.ns ?? "rebecca").trim() || "rebecca";

    // разбор owner/repo/branch
    let owner = body.owner?.trim();
    let repo  = body.repo?.trim();
    const branch = (body.branch ?? "main").trim();

    if (body.url && (!owner || !repo)) {
      const m = body.url.match(/github\.com\/([^\/]+)\/([^\/#]+)(?:\/|#|$)/i);
      if (m) { owner = m[1]; repo = m[2]; }
    }
    if (!owner || !repo) return jsonErr(400, "Provide 'url' or 'owner'+'repo'");

    const maxFiles  = clampInt(body.maxFiles ?? 120, 1, 2000);
    const maxSizeKB = clampInt(body.maxSizeKB ?? 150, 10, 2048);
    const includeExt = (body.includeExt?.length ? body.includeExt : DEFAULT_EXT).map(e => e.toLowerCase());
    const excludeDirs = (body.excludeDirs?.length ? body.excludeDirs : DEFAULT_EXCLUDE);

    // 1) дерево файлов через GitHub API
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const ghHeaders: Record<string,string> = { "Accept":"application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const treeResp = await fetch(treeUrl, { headers: ghHeaders });
    if (!treeResp.ok) {
      return jsonErr(502, `GitHub tree error: ${treeResp.status} ${await treeResp.text()}`);
    }
    const treeJson: any = await treeResp.json();
    const allFiles = (treeJson.tree ?? []).filter((n: any) => n.type === "blob") as {path:string; sha:string}[];

    // 2) фильтрация
    const files = allFiles.filter(f => {
      const p = "/" + f.path;
      if (excludeDirs.some(d => p.includes("/" + d + "/"))) return false;
      const ext = ("." + (f.path.split(".").pop() ?? "")).toLowerCase();
      return includeExt.includes(ext);
    }).slice(0, maxFiles);

    const inserted: { path: string; count: number }[] = [];

    // 3) качаем raw-файлы и нарезаем
    for (const f of files) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`;
      const r = await fetch(rawUrl, { headers: ghHeaders });
      if (!r.ok) continue;

      const buf = await r.arrayBuffer();
      if (buf.byteLength / 1024 > maxSizeKB) continue;

      const text = bufferToUtf8(buf);
      if (!looksText(text)) continue;

      const chunks = splitIntoChunks(text, body.chunk);
      let added = 0;

      for (const chunk of chunks) {
        const vec = await getEmbedding(chunk);
        const vecParam = toVectorLiteral(vec);

        // ВСЕГДА кладём ns в metadata:
        const meta = {
          ...(body.metadata ?? {}),
          ns,
          source: "github",      // единый ключ source
          owner, repo, branch,
          path: f.path,
        };

        const sql = `
          INSERT INTO memories (id, initiative_id, kind, content, embedding, metadata)
          VALUES (gen_random_uuid(), NULL, $1, $2, $3::vector, $4::jsonb)
        `;
        const kind = inferKindByPath(f.path);
        await pool.query(sql, [kind, chunk, vecParam, JSON.stringify(meta)]);
        added++;
        await sleep(60);
      }

      inserted.push({ path: f.path, count: added });
    }

    return jsonOk({
      ok: true, ns, owner, repo, branch,
      filesProcessed: inserted.length,
      totalChunks: inserted.reduce((a, x) => a + x.count, 0),
      details: inserted
    });
  } catch (e: any) {
    console.error("import/github error:", e);
    return jsonErr(500, String(e?.message ?? e));
  }
}

/* utils */
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const clampInt = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(n)));

function bufferToUtf8(buf: ArrayBuffer) {
  try { return new TextDecoder("utf-8", { fatal:false }).decode(new Uint8Array(buf)); }
  catch { return ""; }
}
function looksText(s: string) {
  // грубая эвристика: почти нет NUL-символов
  const bad = (s.match(/\u0000/g) || []).length;
  return bad < 2;
}
function inferKindByPath(p: string) {
  const ext = ("." + (p.split(".").pop() ?? "")).toLowerCase();
  if ([".md",".txt",".rst",".tex"].includes(ext)) return "doc";
  return "code";
}
