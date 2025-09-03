import { NextResponse } from "next/server";
import { embedMany } from "@/lib/embeddings";
import { upsertMemoriesBatch } from "@/lib/memories";
import { chunkText, normalizeChunkOpts } from "@/lib/chunking";

// простая версия: скачиваем raw-файлы по списку путей (или каталог), без git-clone
type Body = {
  ns: string;
  repo: string;     // owner/name
  ref?: string;     // ветка/тег/sha (по умолчанию main)
  paths?: string[]; // список файлов внутри репо
  chunk?: { chars?: number; overlap?: number };
};

async function fetchRaw(repo: string, ref: string, path: string) {
  // GitHub raw
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`fetch ${path} failed (${r.status})`);
  return await r.text();
}

export async function POST(req: Request) {
  const stage = { value: "init" as "init" | "download" | "chunking" | "embedding" | "saving" };

  try {
    const b = (await req.json()) as Body;
    const ns = b?.ns?.trim();
    const repo = b?.repo?.trim();
    const ref = (b?.ref || "main").trim();
    const paths = Array.isArray(b?.paths) ? b.paths : [];

    if (!ns || !repo || paths.length === 0) {
      return NextResponse.json({ ok: false, error: "ns, repo and paths[] are required" }, { status: 400 });
    }

    stage.value = "download";
    const files: { path: string; content: string }[] = [];
    for (const p of paths) {
      const content = await fetchRaw(repo, ref, p);
      files.push({ path: p, content });
    }

    stage.value = "chunking";
    const allChunks: { content: string; meta: any }[] = [];
    for (const f of files) {
      const chunks = chunkText(f.content, b?.chunk);
      chunks.forEach((c, i) => allChunks.push({ content: c, meta: { path: f.path, part: i + 1 } }));
    }

    stage.value = "embedding";
    const embeddings = await embedMany(allChunks.map((c) => c.content));

    stage.value = "saving";
    const rows = allChunks.map((c, i) => ({
      ns,
      kind: "github" as const,
      content: c.content,
      embedding: embeddings[i],
      metadata: { ...c.meta, repo, ref, chunk: normalizeChunkOpts(b?.chunk) }
    }));

    await upsertMemoriesBatch(rows as any);

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err), stage: stage.value }, { status: 500 });
  }
}
