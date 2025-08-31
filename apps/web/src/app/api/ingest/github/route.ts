// apps/web/src/app/api/ingest/github/route.ts
import { NextResponse } from "next/server";
import { chunkText } from "@/lib/chunk";
import { upsertMemoriesBatch } from "@/lib/memories";

export const dynamic = "force-dynamic";

const GH = "https://api.github.com";

/* ---------- helpers: headers, token, resilient fetch ---------- */

function baseGhHeaders(): Record<string, string> {
  return {
    "user-agent": "FreyaRebecca/ingest",
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

function getToken(): string {
  return (process.env.GITHUB_TOKEN || "").trim();
}

/** GitHub fetch с fallback: Bearer → token. Возвращает {res, scheme} */
async function ghFetch(
  url: string,
  init?: RequestInit
): Promise<{ res: Response; scheme: "bearer" | "token" | "none" }> {
  const tk = getToken();
  const base = baseGhHeaders();

  // 1) сначала пробуем Bearer
  const h1: Record<string, string> = { ...base, ...(init?.headers as any) };
  if (tk) h1.authorization = `Bearer ${tk}`;
  const res1 = await fetch(url, { ...init, headers: h1 });
  if (res1.status !== 401 || !tk) {
    return { res: res1, scheme: tk ? "bearer" : "none" };
  }

  // 2) если 401 — пробуем 'token'
  const h2: Record<string, string> = {
    ...base,
    ...(init?.headers as any),
    authorization: `token ${tk}`,
  };
  const res2 = await fetch(url, { ...init, headers: h2 });
  return { res: res2, scheme: "token" };
}

/* ------------------------------- route ------------------------------- */

/**
 * POST /api/ingest/github
 * Body: { repo: "owner/name", ref?: "main", pathPrefix?: string, exts?: string[], maxFiles?: number, kind: string }
 * Требует заголовок: x-admin-key (проверяется в middleware)
 */
export async function POST(req: Request) {
  try {
    const {
      repo,
      ref = "main",
      pathPrefix = "",
      exts,
      maxFiles = 40,
      kind,
    } = (await req.json()) as {
      repo?: string;
      ref?: string;
      pathPrefix?: string;
      exts?: string[];
      maxFiles?: number;
      kind?: string;
    };

    if (!repo || !kind) {
      return NextResponse.json(
        { ok: false, error: "repo and kind are required" },
        { status: 400 }
      );
    }

    // 0) sanity: доступ к репозиторию
    const infoTry = await ghFetch(`${GH}/repos/${repo}`);
    if (!infoTry.res.ok) {
      const t = await infoTry.res.text();
      return NextResponse.json(
        {
          ok: false,
          error: `repo failed: ${infoTry.res.status}`,
          scheme: infoTry.scheme,
          body: t.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // 1) refs/heads/{ref} -> commit.sha
    const rTry = await ghFetch(`${GH}/repos/${repo}/git/refs/heads/${ref}`);
    if (!rTry.res.ok) {
      const t = await rTry.res.text();
      return NextResponse.json(
        {
          ok: false,
          error: `refs failed: ${rTry.res.status}`,
          scheme: rTry.scheme,
          body: t.slice(0, 500),
        },
        { status: 502 }
      );
    }
    const refJson = (await rTry.res.json()) as any;
    const commitSha = refJson?.object?.sha;

    // 2) commit -> tree.sha
    const cTry = await ghFetch(`${GH}/repos/${repo}/git/commits/${commitSha}`);
    if (!cTry.res.ok) {
      const t = await cTry.res.text();
      return NextResponse.json(
        {
          ok: false,
          error: `commit failed: ${cTry.res.status}`,
          scheme: cTry.scheme,
          body: t.slice(0, 500),
        },
        { status: 502 }
      );
    }
    const commitJson = (await cTry.res.json()) as any;
    const treeSha = commitJson?.tree?.sha;

    // 3) дерево по treeSha
    const treeTry = await ghFetch(
      `${GH}/repos/${repo}/git/trees/${treeSha}?recursive=1`
    );
    if (!treeTry.res.ok) {
      const t = await treeTry.res.text();
      return NextResponse.json(
        {
          ok: false,
          error: `tree failed: ${treeTry.res.status}`,
          scheme: treeTry.scheme,
          body: t.slice(0, 500),
        },
        { status: 502 }
      );
    }
    const tree = (await treeTry.res.json()) as any;

    const nodes: any[] = (tree?.tree ?? []).filter(
      (x: any) =>
        x.type === "blob" &&
        (!pathPrefix || String(x.path).startsWith(pathPrefix))
    );

    const okExts =
      exts && exts.length
        ? exts.map((s) => s.toLowerCase())
        : [
            ".md",
            ".txt",
            ".rst",
            ".js",
            ".ts",
            ".tsx",
            ".py",
            ".go",
            ".rs",
            ".java",
            ".kt",
            ".swift",
            ".cs",
            ".cpp",
            ".c",
            ".hpp",
            ".json",
            ".yml",
            ".yaml",
          ];

    const files = nodes
      .filter((x) =>
        okExts.some((ext) => String(x.path).toLowerCase().endsWith(ext))
      )
      .slice(0, maxFiles);

    const upserts: { content: string; metadata: any }[] = [];

    for (const f of files) {
      const cTry2 = await ghFetch(
        `${GH}/repos/${repo}/contents/${encodeURIComponent(
          f.path
        )}?ref=${encodeURIComponent(ref)}`
      );
      if (!cTry2.res.ok) continue;

      const cJson = (await cTry2.res.json()) as any;
      if (!cJson?.content || cJson.encoding !== "base64") continue;

      const raw = Buffer.from(cJson.content, "base64").toString("utf8");
      if (!raw || raw.length < 50) continue;

      const pieces = chunkText(raw, { size: 1500, overlap: 200, minSize: 400 });
      pieces.forEach((content, idx) =>
        upserts.push({
          content,
          metadata: {
            source_type: "github",
            repo,
            ref,
            path: f.path,
            sha: f.sha,
            chunk_index: idx,
            url: `https://github.com/${repo}/blob/${ref}/${f.path}`,
          },
        })
      );
    }

    if (!upserts.length) {
      return NextResponse.json(
        { ok: false, error: "no files matched" },
        { status: 422 }
      );
    }

    const inserted = await upsertMemoriesBatch(kind, upserts);

    return NextResponse.json({
      ok: true,
      repo,
      ref,
      count: inserted.length,
      insertedSample: inserted.slice(0, 3),
    });
  } catch (e: any) {
    console.error("POST /api/ingest/github error:", e?.message ?? e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
