// apps/web/src/app/api/ingest/github/route.ts
import { NextResponse } from "next/server";
import { chunkText } from "../../../../lib/chunk";
import { upsertMemoriesBatch } from "../../../../lib/memories";

const GH = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;

export const dynamic = "force-dynamic";

/**
 * POST /api/ingest/github
 * Body: { repo: "owner/name", ref?: "main", pathPrefix?: string, exts?: string[], maxFiles?: number, kind: string }
 * Требует заголовок: x-admin-key
 */
export async function POST(req: Request) {
  try {
    const { repo, ref = "main", pathPrefix = "", exts, maxFiles = 40, kind } = await req.json() as {
      repo?: string; ref?: string; pathPrefix?: string; exts?: string[]; maxFiles?: number; kind?: string;
    };
    if (!repo || !kind) return NextResponse.json({ ok:false, error:"repo and kind are required" }, { status:400 });

    const headers: Record<string,string> = { "user-agent": "FreyaRebecca/ingest", "accept": "application/vnd.github+json" };
    if (TOKEN) headers["authorization"] = `Bearer ${TOKEN}`;

    // 1) получаем дерево файлов
    const treeRes = await fetch(`${GH}/repos/${repo}/git/trees/${ref}?recursive=1`, { headers });
    if (!treeRes.ok) return NextResponse.json({ ok:false, error:`tree failed: ${treeRes.status}` }, { status:502 });
    const tree = await treeRes.json() as any;
    const items = (tree?.tree ?? []).filter((x: any) => x.type === "blob" && (!pathPrefix || String(x.path).startsWith(pathPrefix)));

    // расширения по умолчанию
    const okExts = (exts && exts.length) ? exts.map(s => s.toLowerCase()) :
      [".md",".txt",".rst",".js",".ts",".tsx",".py",".go",".rs",".java",".kt",".swift",".cs",".cpp",".c",".hpp",".json",".yml",".yaml"];

    const files = items
      .filter((x: any) => okExts.some(ext => String(x.path).toLowerCase().endsWith(ext)))
      .slice(0, maxFiles);

    const upserts: { content: string; metadata: any }[] = [];

    for (const f of files) {
      // 2) тянем содержимое файла Contents API
      const cRes = await fetch(`${GH}/repos/${repo}/contents/${encodeURIComponent(f.path)}?ref=${encodeURIComponent(ref)}`, { headers });
      if (!cRes.ok) continue;
      const c = await cRes.json() as any;
      if (!c?.content || c.encoding !== "base64") continue;

      const raw = Buffer.from(c.content, "base64").toString("utf8");
      if (!raw || raw.length < 50) continue;

      const pieces = chunkText(raw, { size: 1500, overlap: 200, minSize: 400 });
      pieces.forEach((content, idx) => {
        upserts.push({
          content,
          metadata: {
            source_type: "github",
            repo,
            ref,
            path: f.path,
            sha: f.sha,
            chunk_index: idx,
            url: `https://github.com/${repo}/blob/${ref}/${f.path}`
          }
        });
      });
    }

    if (!upserts.length) return NextResponse.json({ ok:false, error:"no files matched" }, { status:422 });

    const inserted = await upsertMemoriesBatch(kind, upserts);
    return NextResponse.json({ ok:true, repo, ref, count: inserted.length, insertedSample: inserted.slice(0,3) });
  } catch (e:any) {
    console.error("POST /api/ingest/github error:", e?.message ?? e);
    return NextResponse.json({ ok:false, error:String(e?.message ?? e) }, { status:500 });
  }
}
