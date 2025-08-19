// apps/web/src/app/api/memory/import/github/route.ts
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";
import { splitIntoChunks } from "@/lib/chunk";
import { suggestNamespace } from "@/lib/suggestNs";

export const runtime = "nodejs";

type Body = {
  ns?: string;               // можно не указывать — определим автоматически
  url?: string;              // https://github.com/owner/repo
  branch?: string;
  maxFiles?: number;
  maxSizeKB?: number;
  includeExt?: string[];
  excludeDirs?: string[];
  chunk?: { size?: number; overlap?: number };
  metadata?: Record<string, any>;
  autoConfirm?: boolean;     // если false и уверенность низкая — вернём предложение
};

// очень простой fetcher — читаем файлы через raw.githubusercontent.com
async function fetchRepoFile(owner: string, repo: string, branch: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed: ${url} ${r.status}`);
  return await r.text();
}

// получаем список файлов (для простоты — через GitHub API v3 без токена, публичные репо)
async function listRepoFiles(owner: string, repo: string, branch: string): Promise<string[]> {
  // минимальный обход: корень + несколько подпапок — для прода лучше делать свой маленький crawler
  const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const r = await fetch(api, { headers: { "User-Agent": "freya-rebecca" } });
  if (!r.ok) throw new Error(`list files failed: ${r.status}`);
  const j = await r.json();
  return (j.tree ?? [])
    .filter((x: any) => x.type === "blob")
    .map((x: any) => x.path);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const url = String(body.url ?? "").trim();
    if (!url) return jsonErr(400, "Provide 'url' to GitHub repo");
    const m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/#]+)(?:$|\/|#)/i);
    if (!m) return jsonErr(400, "URL must be like https://github.com/owner/repo");

    const owner = m[1], repo = m[2];
    const branch = (body.branch ?? "main");

    // 1) если ns не задан — предложим
    let ns = (body.ns ?? "").trim();
    let decided = true;
    if (!ns) {
      const s = await suggestNamespace({
        title: repo,
        description: `GitHub repository ${owner}/${repo}. ${body.metadata?.comment ?? ""}`,
        mediaType: "github",
        tags: ["agents","repo","code"],
      });
      ns = s.ns;
      decided = s.decided;
      if (!body.autoConfirm && !decided) {
        return jsonOk({ suggested: s, notice: "Not imported. Provide ns or set autoConfirm=true." }, 202);
      }
    }

    const includeExt = new Set((body.includeExt ?? [".md",".txt",".py",".ts",".js",".json",".yaml",".yml",".toml",".ini",".sh",".sql"]).map(x => x.toLowerCase()));
    const excludeDirs = new Set((body.excludeDirs ?? ["node_modules","dist",".git",".next","build","out"]).map(x => x.toLowerCase()));
    const maxFiles = Math.max(1, Math.min(500, Math.floor(body.maxFiles ?? 80)));
    const maxSizeKB = Math.max(1, Math.min(2048, Math.floor(body.maxSizeKB ?? 300)));

    const files = (await listRepoFiles(owner, repo, branch))
      .filter(p => ![...excludeDirs].some(d => p.toLowerCase().startsWith(d + "/")))
      .filter(p => includeExt.has(("." + p.split(".").pop()).toLowerCase()))
      .slice(0, maxFiles);

    let inserted = 0;
    for (const path of files) {
      const content = await fetchRepoFile(owner, repo, branch, path);
      const kb = Math.ceil(Buffer.byteLength(content, "utf8") / 1024);
      if (kb > maxSizeKB) continue;

      const parts = splitIntoChunks(content, body.chunk ?? {});
      for (const p of parts) {
        const emb = await getEmbedding(p);
        const vec = toVectorLiteral(emb);
        const meta = {
          ...(body.metadata ?? {}),
          ns,
          source: "github",
          repo: `${owner}/${repo}`,
          path,
          lang: detectLang(p),
        };
        await pool.query(
          `INSERT INTO memories (kind, content, embedding, metadata)
           VALUES ($1, $2, $3::vector, $4::jsonb)`,
          ["doc", p, vec, JSON.stringify(meta)]
        );
        inserted++;
      }
    }

    return jsonOk({ ns, repo: `${owner}/${repo}`, inserted, decided });
  } catch (e: any) {
    return jsonErr(500, String(e?.message ?? e));
  }
}

function detectLang(t: string): string {
  return /[а-яА-ЯЁё]/.test(t) ? "ru" : "en";
}
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
