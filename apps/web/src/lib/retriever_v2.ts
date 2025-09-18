// apps/web/src/lib/retriever_v2.ts
import { pool } from "@/lib/db";
import { embedMany } from "@/lib/embeddings";

/** Безопасный embedQuery: несколько попыток импорта, иначе fallback на embedMany */
async function embedQuerySafe(q: string): Promise<number[]> {
  try {
    const modRel = await import("./embeddings");
    if (typeof (modRel as any).embedQuery === "function") {
      return await (modRel as any).embedQuery(q);
    }
  } catch {}
  try {
    const modAlias = await import("@/lib/embeddings");
    if (typeof (modAlias as any).embedQuery === "function") {
      return await (modAlias as any).embedQuery(q);
    }
  } catch {}
  const [v] = await embedMany([q]);
  return v;
}

export type RecencyOptions = {
  enabled?: boolean;
  halfLifeDays?: number;
  weight?: number;
  usePublishedAt?: boolean;
};

export type RetrieveParams = {
  ns: string;
  slot?: string | null;
  query: string;
  topK?: number;
  candidateK?: number;
  nsMode?: "strict" | "prefix";
  includeKinds?: string[] | null;
  includeSourceTypes?: string[] | null;
  minSimilarity?: number;
  recency?: RecencyOptions;
};

export type RetrievedMatch = {
  id: string;
  kind: string | null;
  ns: string;
  slot: string | null;
  content: string;
  metadata: any;
  created_at: string;
  sim: number;
  rec: number;
  score: number;
  sample: string;
};

export type RetrieveResult = {
  ok: true;
  took_ms: number;
  params: Omit<RetrieveParams, "query"> & { query: string };
  recencyEffective: { enabled: boolean; halfLifeDays: number; weight: number; usedPublishedAt: boolean };
  candidates: number;
  returned: number;
  matches: RetrievedMatch[];
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function buildFilterSql(nsMode: "strict" | "prefix", hasKinds: boolean, hasSrcTypes: boolean) {
  const nsClause =
    nsMode === "prefix"
      ? "ns LIKE ($2 || '%') AND ($3::text IS NULL OR slot = $3)"
      : "ns = $2 AND ($3::text IS NULL OR slot = $3)";
  const parts: string[] = [`(${nsClause})`];
  if (hasKinds) parts.push("(kind = ANY($5::text[]))");
  if (hasSrcTypes) parts.push("(metadata->>'source_type' = ANY($6::text[]))");
  return parts.join(" AND ");
}

export async function retrieveV2(params: RetrieveParams): Promise<RetrieveResult> {
  const t0 = Date.now();
  const {
    ns, slot = "staging", query,
    topK = 5, candidateK = 200,
    nsMode = "strict",
    includeKinds, includeSourceTypes,
    minSimilarity,
    recency,
  } = params;

  if (!ns) throw new Error("ns is required");
  if (!query?.trim()) throw new Error("query is empty");

  // 1) эмбеддинг запроса
  const qvec = await embedQuerySafe(query);
  // ВАЖНО: pgvector ждёт строковый литерал в формате [a,b,c]
  const qvecLit = "[" + qvec.join(",") + "]";

  // 2) кандидаты из ANN
  const K = clamp(topK, 1, 50);
  const CAND = clamp(candidateK, K, 1000);
  const hasKinds = Array.isArray(includeKinds) && includeKinds.length > 0;
  const hasSrcTypes = Array.isArray(includeSourceTypes) && includeSourceTypes.length > 0;

  const where = buildFilterSql(nsMode, hasKinds, hasSrcTypes);
  const sql = `
    SELECT id, kind, ns, slot, content, metadata, created_at,
           (embedding <=> $1::vector) AS dist
    FROM memories
    WHERE ${where}
    ORDER BY embedding <=> $1::vector
    LIMIT $4
  `;
  const args: any[] = [qvecLit, ns, slot, CAND];
  if (hasKinds) args.push(includeKinds);
  if (hasSrcTypes) { if (!hasKinds) args.push([]); args.push(includeSourceTypes); }

  const { rows } = await pool.query(sql, args);

  // 3) доранжировка: similarity + recency
  const alpha = 1 - (recency?.weight ?? 0.2);
  const beta  = (recency?.weight ?? 0.2);
  const half  = clamp(Math.floor(recency?.halfLifeDays ?? Number(process.env.RECENCY_HALFLIFE_DAYS || 30)), 1, 3650);
  const usePub = !!recency?.usePublishedAt;
  const recOn = recency?.enabled !== false;

  const LN2 = Math.log(2);
  const now = Date.now();

  function recencyBoost(r: any) {
    let t = r.created_at ? new Date(r.created_at).getTime() : 0;
    if (usePub) {
      const p = r?.metadata?.published_at ?? r?.metadata?.["published_at"];
      if (typeof p === "string") {
        const tp = Date.parse(p);
        if (!Number.isNaN(tp)) t = tp;
      }
    }
    if (!t) return 0;
    const ageDays = (now - t) / (1000 * 60 * 60 * 24);
    return Math.exp(-LN2 * (ageDays / half));
  }

  const rescored = rows
    .map((r) => {
      const sim = 1 - Number(r.dist);
      const rec = recOn ? recencyBoost(r) : 0;
      const score = alpha * sim + beta * rec;
      return { ...r, sim, rec, score };
    })
    .filter((r) => (typeof minSimilarity === "number" ? r.sim >= minSimilarity : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, K);

  const matches: RetrievedMatch[] = rescored.map((r) => ({
    id: r.id,
    kind: r.kind ?? null,
    ns: r.ns,
    slot: r.slot ?? null,
    content: r.content,
    metadata: r.metadata,
    created_at: r.created_at,
    sim: Number((r as any).sim.toFixed(4)),
    rec: Number((r as any).rec.toFixed(4)),
    score: Number((r as any).score.toFixed(4)),
    sample: (r.content as string)?.slice(0, 240) || "",
  }));

  return {
    ok: true,
    took_ms: Date.now() - t0,
    params: {
      ns, slot, query,
      topK: K, candidateK: CAND,
      nsMode,
      includeKinds: includeKinds ?? null,
      includeSourceTypes: includeSourceTypes ?? null,
      minSimilarity: typeof minSimilarity === "number" ? minSimilarity : undefined,
      recency,
    },
    recencyEffective: {
      enabled: recOn, halfLifeDays: half, weight: beta, usedPublishedAt: usePub,
    },
    candidates: rows.length,
    returned: matches.length,
    matches,
  };
}
