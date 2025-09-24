import { pool } from "@/lib/pg";
import { embedQuery } from "@/lib/embeddings";
import {
  RetrieveRequest,
  RetrieveResponse,
  RetrieveItem,
  clamp,
  matchesDomain,
} from "@/lib/retrieval-contract";

const ALPHA = Number(process.env.RETRIEVE_ALPHA ?? 0.85);
const BETA = Number(process.env.RETRIEVE_BETA ?? 0.15);
const HALF_LIFE_DAYS = Number(process.env.RETRIEVE_T_HALF ?? 180);

function timeDecay(publishedAt: string | null): number {
  if (!publishedAt) return 0.5;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = (Date.now() - t) / 86400000;
  const decay = Math.pow(0.5, ageDays / Math.max(1, HALF_LIFE_DAYS));
  return Math.min(1, Math.max(0, decay));
}

type Row = {
  id: string;
  ns: string;
  slot: string;
  url: string | null;
  title: string | null;
  snippet: string | null;
  published_at: string | null;
  source_type: string | null;
  kind: string | null;
  metadata: any;
  sim: number; // cosine similarity (1 - distance)
};

export async function retrieveV2(req: RetrieveRequest): Promise<RetrieveResponse> {
  const nsMode = (req.nsMode ?? "prefix") as "prefix" | "strict";
  const topK = clamp(req.topK, 1, 50);
  const candidateK = clamp(
    req.candidateK,
    Math.max(topK, 200),
    1000
  );
  const minSimilarity = clamp(req.minSimilarity, 0, 1);

  // 1) эмбеддинг запроса
  const qvec = await embedQuery(req.q);

  // 2) строим SQL без сложного ALLOW/DENY — домен режем пост-фильтром
  const nsExact = req.ns;
  const nsLike = `${req.ns}/%`;
  const whereNs =
    nsMode === "strict" ? `ns = $2` : `(ns = $2 OR ns LIKE $3)`;

  const sql = `
    SELECT
      id, ns, slot, url, title, snippet,
      COALESCE(to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), NULL) AS published_at,
      source_type, kind, metadata,
      (1 - (embedding <=> $VEC::vector)) AS sim
    FROM chunks
    WHERE slot = $1 AND ${whereNs}
    ORDER BY embedding <=> $VEC::vector ASC
    LIMIT $LIM
  `;

  // параметры: slot, ns, (nsLike?), VEC, LIM
  const params: any[] = [req.slot, nsExact];
  if (nsMode !== "strict") params.push(nsLike);
  params.push(`[${qvec.join(",")}]`);
  params.push(candidateK);

  // 3) заменим спец-маркеры в тексте ($VEC/$LIM) на позиционные
  // найдём индексы под VEC и LIM
  const vecIndex = params.length - 2;
  const limIndex = params.length - 1;
  let finalSQL = sql
    .replace(/\$VEC/g, `$${vecIndex + 1}`)
    .replace(/\$LIM/g, `$${limIndex + 1}`);

  // 4) выполняем
  const res: any = await pool.query(finalSQL, params);
  const rows: Row[] = res?.rows ?? [];

  // 5) пост-фильтры
  const afterSim = rows.filter((r) => r.sim >= minSimilarity);
  const afterDomain = afterSim.filter((r) => matchesDomain(r.url, req.domainFilter));

  // 6) скоринг + topK
  const items: RetrieveItem[] = afterDomain
    .map((r) => {
      const score = ALPHA * r.sim + BETA * timeDecay(r.published_at);
      return {
        id: r.id,
        ns: r.ns,
        slot: r.slot as "staging" | "prod",
        url: r.url,
        title: r.title,
        snippet: r.snippet,
        publishedAt: r.published_at,
        sourceType: r.source_type,
        kind: r.kind,
        metadata: r.metadata ?? {},
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return {
    items,
    filterInfo: {
      nsMode,
      candidateK,
      minSimilarity,
      droppedAfterSimilarity: rows.length - afterSim.length,
      droppedAfterDomain: afterSim.length - afterDomain.length,
      domainAllow: req.domainFilter?.allow ?? [],
      domainDeny: req.domainFilter?.deny ?? [],
    },
    debugVersion: "rc-v1",
  };
}
