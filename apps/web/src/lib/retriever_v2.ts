// apps/web/src/lib/retriever_v2.ts
import { pool } from "@/lib/pg";
import { embedQuery } from "@/lib/embeddings";
import {
  RetrieveRequest,
  RetrieveResponse,
  RetrieveItem,
  // clamp,          // <-- больше НЕ импортируем из контракта
} from "@/lib/retrieval-contract";
import { matchesDomain } from "@/lib/domain_filter";

const ALPHA = Number(process.env.RETRIEVE_ALPHA ?? 0.85);
const BETA = Number(process.env.RETRIEVE_BETA ?? 0.15);
const HALF_LIFE_DAYS = Number(process.env.RETRIEVE_T_HALF ?? 180);

// Локальная утилита вместо импорта из контракта
function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
// Безопасные числовые дефолты
function numOr<T extends number>(v: any, d: T): T {
  const n = Number(v);
  return Number.isFinite(n) ? (n as T) : d;
}

function timeDecay(publishedAt: string | null): number {
  if (!publishedAt) return 0.5;
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = (Date.now() - t) / 86400000;
  const decay = Math.pow(0.5, ageDays / Math.max(1, HALF_LIFE_DAYS));
  return clamp(decay, 0, 1);
}

type Row = {
  id: string;
  ns: string;
  slot: string;
  url: string | null;
  title: string | null;
  content: string | null;
  published_at: string | null;
  source_type: string | null;
  kind: string | null;
  metadata: Record<string, any> | null;
  sim: number;
};

// собираем SQL-предикаты для доменов
function buildDomainSQL(df: RetrieveRequest["domainFilter"]) {
  const clauses: string[] = [];
  const params: string[] = [];
  const hostExpr = `lower(NULLIF(regexp_replace(url, '^https?://([^/]+).*$', '\\1'), ''))`;

  if (df?.allow && df.allow.length) {
    const allowOrs: string[] = [];
    for (const d of df.allow) {
      const dom = d.toLowerCase().trim();
      allowOrs.push(`(${hostExpr} = $AL${params.length + 1} OR ${hostExpr} LIKE $AL${params.length + 2})`);
      params.push(dom, `%.${dom}`);
    }
    clauses.push(`url IS NOT NULL AND (${allowOrs.join(" OR ")})`);
  }

  if (df?.deny && df.deny.length) {
    for (const d of df.deny) {
      const dom = d.toLowerCase().trim();
      clauses.push(`NOT ( ${hostExpr} = $DN${params.length + 1} OR ${hostExpr} LIKE $DN${params.length + 2} )`);
      params.push(dom, `%.${dom}`);
    }
  }

  return { clause: clauses.length ? clauses.join(" AND ") : "", rawParams: params };
}

export async function retrieveV2(req: RetrieveRequest): Promise<RetrieveResponse> {
  // безопасные дефолты
  const topK = clamp(numOr(req.topK, 5), 1, 50);
  const candidateK = clamp(numOr(req.candidateK, Math.max(5, topK)), topK, 1000);
  const minSimilarity = numOr(req.minSimilarity, 0);

  // эмбеддинг запроса
  const qvec = await embedQuery(req.q);

  // ns-фильтр
  const nsExact = req.ns;
  const nsLike = `${req.ns}/%`;
  const whereNs = req.nsMode === "strict" ? `ns = $2` : `(ns = $2 OR ns LIKE $3)`;

  // доменные предикаты
  const { clause: domainClauseRaw } = buildDomainSQL(req.domainFilter);

  // Соберём WHERE с нормальной нумерацией плейсхолдеров
  const whereParts: string[] = [
    `slot = $1`,
    whereNs,
  ];
  let next = req.nsMode === "strict" ? 3 : 4;

  if (domainClauseRaw) {
    // Пересобираем allow/deny с обычной нумерацией
    const hostExpr = `lower(NULLIF(regexp_replace(url, '^https?://([^/]+).*$', '\\1'), ''))`;
    const allow = req.domainFilter?.allow ?? [];
    const deny = req.domainFilter?.deny ?? [];
    const parts: string[] = [];

    if (allow.length) {
      const ors: string[] = [];
      for (let i = 0; i < allow.length; i++) {
        const a1 = `$${next++}`;
        const a2 = `$${next++}`;
        ors.push(`(${hostExpr} = ${a1} OR ${hostExpr} LIKE ${a2})`);
      }
      parts.push(`url IS NOT NULL AND (${ors.join(" OR ")})`);
    }

    if (deny.length) {
      for (let i = 0; i < deny.length; i++) {
        const d1 = `$${next++}`;
        const d2 = `$${next++}`;
        parts.push(`NOT ( ${hostExpr} = ${d1} OR ${hostExpr} LIKE ${d2} )`);
      }
    }

    if (parts.length) whereParts.push(parts.join(" AND "));
  }

  const finalSQL = `
    SELECT
      id, ns, slot, url, title, content,
      COALESCE(to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), NULL) AS published_at,
      source_type, kind, metadata,
      (1 - (embedding <=> $${next}::vector)) AS sim
    FROM chunks
    WHERE ${whereParts.join(" AND ")}
    ORDER BY embedding <=> $${next}::vector ASC
    LIMIT $${next + 1}
  `;

  // Параметры в правильном порядке:
  const finalParams: any[] = [];
  finalParams.push(req.slot, nsExact);
  if (req.nsMode !== "strict") finalParams.push(nsLike);

  if (req.domainFilter?.allow?.length) {
    for (const d of req.domainFilter.allow) {
      const dom = d.toLowerCase().trim();
      finalParams.push(dom, `%.${dom}`);
    }
  }
  if (req.domainFilter?.deny?.length) {
    for (const d of req.domainFilter.deny) {
      const dom = d.toLowerCase().trim();
      finalParams.push(dom, `%.${dom}`);
    }
  }

  finalParams.push(`[${qvec.join(",")}]`);
  finalParams.push(candidateK);

  const res = await pool.query<Row>(finalSQL, finalParams);
  const rows: Row[] = res.rows;

  // пост-фильтр по схожести + домены
  const afterSim: Row[] = rows.filter((r: Row) => r.sim >= minSimilarity);
  const afterDomain: Row[] = afterSim.filter((r: Row) => matchesDomain(r.url, req.domainFilter));

  // скоринг + topK
  const mapped: RetrieveItem[] = afterDomain.map((r: Row): RetrieveItem => {
    const score = ALPHA * r.sim + BETA * timeDecay(r.published_at);
    return {
      id: r.id,
      url: r.url,
      title: r.title,
      content: r.content,
      score,
    };
  });

  const items: RetrieveItem[] = mapped
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);

  const filterInfo = {
    allowMatched: afterDomain.length,
    denySkipped: rows.length - afterDomain.length,
  };

  // Контракт текущей версии: без поля ok
  return { items, filterInfo, debugVersion: "rc-v1" };
}
