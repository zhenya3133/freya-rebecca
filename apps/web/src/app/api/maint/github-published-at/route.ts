// apps/web/src/app/api/maint/github-published-at/route.ts
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getPool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: string | null;
  owner?: string | null;
  repo?: string | null;
  cursor?: number | null;
  limit?: number | null;
  dryRun?: boolean | null;
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

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": UA,
  };
  const tok = (process.env.GITHUB_TOKEN || "").trim();
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  return h;
}

async function gh<T = any>(url: string) {
  const res = await fetch(url, { headers: ghHeaders(), redirect: "follow" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** ISO-дата последнего коммита по файлу (или null). */
async function fetchLatestCommitDate(owner: string, repo: string, path: string, ref?: string): Promise<string | null> {
  const q = new URLSearchParams({
    path,
    per_page: "1",
    ...(ref ? { sha: ref } : {}),
  }).toString();
  const url = `${GH}/repos/${owner}/${repo}/commits?${q}`;
  try {
    const arr = await gh<any[]>(url);
    const c = Array.isArray(arr) && arr.length ? arr[0] : null;
    const iso: string | undefined = c?.commit?.author?.date || c?.commit?.committer?.date;
    return typeof iso === "string" ? iso : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  const client: any = await (getPool() as any).connect();
  try {
    assertAdmin(req);
    const {
      ns,
      slot = "staging",
      owner: ownerFilter,
      repo: repoFilter,
      cursor = 0,
      limit = 200,
      dryRun = false,
    } = (await req.json()) as Body;

    if (!ns) return NextResponse.json({ ok: false, error: "ns required" }, { status: 400 });

    // 1) Выбрать уникальные пути без published_at
    stage = "select-paths";
    const pathsSql = `
      SELECT DISTINCT
        (metadata->>'path') AS path,
        (metadata->>'owner') AS owner,
        (metadata->>'repo')  AS repo,
        (metadata->>'ref')   AS ref
      FROM memories
      WHERE ns=$1 AND ($2::text IS NULL OR slot=$2)
        AND metadata->>'source_type'='github'
        AND NOT (metadata ? 'published_at')
        AND ($3::text IS NULL OR metadata->>'owner'=$3)
        AND ($4::text IS NULL OR metadata->>'repo'=$4)
      ORDER BY 1
      OFFSET $5 LIMIT $6
    `;
    const { rows: paths } = await client.query(pathsSql, [
      ns,
      slot,
      ownerFilter ?? null,
      repoFilter ?? null,
      Math.max(0, Number(cursor) || 0),
      Math.max(1, Math.min(Number(limit) || 200, 1000)),
    ]);

    if (paths.length === 0) {
      return NextResponse.json({
        ok: true,
        ns,
        slot,
        scanned: 0,
        updated_paths: 0,
        updated_rows: 0,
        nextCursor: null,
        ms: Date.now() - t0,
      });
    }

    const nextCursor = (cursor || 0) + paths.length;

    // 2) Сходить в GitHub за датами
    stage = "fetch-commits";
    const updates: Array<{ path: string; owner: string; repo: string; ref?: string | null; published_at: string }> = [];
    for (const p of paths) {
      const owner = p.owner || ownerFilter;
      const repo  = p.repo  || repoFilter;
      if (!owner || !repo || !p.path) continue;
      const iso = await fetchLatestCommitDate(owner, repo, p.path, p.ref || undefined);
      if (iso) updates.push({ path: p.path, owner, repo, ref: p.ref, published_at: iso });
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        ns,
        slot,
        scanned: paths.length,
        willUpdate: updates.length,
        nextCursor,
        preview: updates.slice(0, 10),
        ms: Date.now() - t0,
      });
    }

    // 3) Обновить JSONB: jsonb_set с явным to_jsonb($4::text)
    stage = "update-db";
    let updatedRows = 0;
    await client.query("BEGIN");
    const updSql = `
      UPDATE memories
      SET metadata = jsonb_set(metadata, '{published_at}', to_jsonb($4::text), true)
      WHERE ns=$1 AND ($2::text IS NULL OR slot=$2)
        AND metadata->>'source_type'='github'
        AND metadata->>'path'=$3
    `;
    for (const u of updates) {
      const res = await client.query(updSql, [ns, slot, u.path, u.published_at]);
      updatedRows += res.rowCount || 0;
    }
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      ns,
      slot,
      scanned: paths.length,
      updated_paths: updates.length,
      updated_rows: updatedRows,
      nextCursor,
      ms: Date.now() - t0,
    });
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ ok: false, stage, error: e?.message || String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
