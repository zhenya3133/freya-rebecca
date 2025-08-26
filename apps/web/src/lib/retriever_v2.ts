import { q } from "@/lib/db";
import OpenAI from "openai";
import { RECENCY, timeDecay } from "@/lib/recency";

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type RetrieveOpts = {
  ns: string;
  query: string;
  fetchK?: number;
  topK?: number;
  minScore?: number;
  slot?: "staging" | "prod";
  lambda?: number;
};

export type RetrievedChunk = {
  id: string;
  content: string;
  source: any | null;
  created_at: string;
  dense: number;
  bm25: number;
  age_days: number;
  emb: number[];
  final: number;
};

function nsRecency(ns: string) {
  return RECENCY[ns] || { halfLifeDays: 180, ttlDays: 365, alpha: 0.75, beta: 0.15, gamma: 0.10 };
}

function parsePgVectorText(s: string): number[] {
  const m = /^\s*\[([^\]]*)\]\s*$/.exec(String(s ?? ""));
  if (!m) return [];
  return m[1].split(",").map(x => Number(x.trim())).filter(v => Number.isFinite(v));
}

async function embedQuery(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({ model: EMBED_MODEL, input: [text] });
  return r.data[0].embedding as unknown as number[];
}

/**
 * Кандидаты из БД с учётом pubdate и TTL.
 * age_days считается от:
 *   source.metadata.published_at -> source.published_at -> created_at
 * Документы старше ttlDays (если задан) отфильтровываются.
 */
async function dbCandidates(
  ns: string,
  query: string,
  qVec: number[],
  slot: "staging" | "prod",
  fetchK: number,
  ttlDays?: number
): Promise<RetrievedChunk[]> {
  const qvecText = "[" + qVec.map(x => Number(x).toFixed(6)).join(",") + "]";

  const rows = await q<any>(`
    with base as (
      select
        id,
        content,
        source,
        created_at,
        coalesce(
          nullif((source->'metadata'->>'published_at'), '')::timestamptz,
          nullif((source->>'published_at'), '')::timestamptz,
          created_at
        ) as pub_ts,
        (1 - (embedding <=> $2::vector)) as dense,
        ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) as bm25,
        (embedding::text) as emb_text
      from chunks
      where ns = $3 and slot = $4
    )
    select
      id, content, source, created_at, dense, bm25,
      extract(epoch from (now() - pub_ts))/86400.0 as age_days,
      emb_text
    from base
    where ($6::int is null) or (now() - pub_ts <= make_interval(days => $6::int))
    order by (dense + bm25) desc
    limit $5;
  `, [query, qvecText, ns, slot, fetchK, (ttlDays ?? null)]);

  return rows.map((r: any) => ({
    id: r.id,
    content: r.content,
    source: r.source || null,
    created_at: r.created_at,
    dense: Number(r.dense) || 0,
    bm25: Math.min(Number(r.bm25) || 0, 1),
    age_days: Math.max(Number(r.age_days) || 0, 0),
    emb: parsePgVectorText(r.emb_text),
    final: 0
  }));
}

function cos(a: number[], b: number[]): number {
  let num = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const x = a[i], y = b[i];
    num += x * y; na += x * x; nb += y * y;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb) || 1e-8;
  return num / den;
}

function mmrSelect(qVec: number[], cand: RetrievedChunk[], topK: number, lambda = 0.7): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  const rest = cand.slice();
  while (selected.length < topK && rest.length > 0) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      const rel = cos(qVec, c.emb);
      let div = 0;
      for (const s of selected) div = Math.max(div, cos(c.emb, s.emb));
      const mmr = lambda * rel - (1 - lambda) * div;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    selected.push(rest.splice(bestIdx, 1)[0]);
  }
  return selected;
}

export async function retrieveV2(opts: RetrieveOpts): Promise<RetrievedChunk[]> {
  const { ns, query, fetchK = 24, topK = 8, minScore = 0.52, slot = "staging", lambda = 0.7 } = opts;

  const qVec = await embedQuery(query);
  const rc = nsRecency(ns);

  // Вытаскиваем кандидатов с учетом TTL
  let cand = await dbCandidates(ns, query, qVec, slot, fetchK, rc.ttlDays);

  // Финальный скоринг: dense + bm25 + recency(timeDecay)
  cand = cand.map(c => {
    const t = timeDecay(c.age_days, rc.halfLifeDays);
    const final = rc.alpha * c.dense + rc.gamma * c.bm25 + rc.beta * t;
    return { ...c, final };
  });

  // Отсечка по порогу и сортировка
  cand = cand.filter(c => c.final >= minScore).sort((a, b) => b.final - a.final);

  // MMR-диверсификация
  const picked = mmrSelect(qVec, cand, Math.min(topK, cand.length), lambda);
  picked.sort((a, b) => b.final - a.final);
  return picked;
}
