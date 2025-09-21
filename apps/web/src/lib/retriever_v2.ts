// apps/web/src/lib/retriever_v2.ts
import { embedQuery } from "@/lib/embeddings";
import { pool } from "@/lib/pg";

/** Настройки «свежести» результата. */
export type RecencyOptions = {
  enabled: boolean;
  halfLifeDays: number;    // период полураспада (дни)
  weight: number;          // вес свежести в итоговом score [0..1]
  usePublishedAt: boolean; // брать published_at из metadata, иначе created_at
};

/** Фильтр доменов по URL в metadata->>'url'. */
export type DomainFilter = {
  allow?: string[];
  deny?: string[];
};

type RetrieveParams = {
  ns: string;
  slot: string;
  query: string;

  topK: number;
  candidateK: number;

  nsMode?: "strict" | "prefix";
  includeKinds?: string[] | null;
  includeSourceTypes?: string[] | null;

  minSimilarity?: number;            // [0..1]
  recency?: RecencyOptions | null;
  domainFilter?: DomainFilter | null;
};

type Row = {
  id: string;
  kind: string;
  ns: string;
  slot: string;
  content: string;
  metadata: any;
  created_at: string | null;
  dist: number;     // расстояние
  sim_raw: number;  // 1/(1+dist)
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function nowUtc(): number {
  return Date.now();
}

function daysBetween(fromIso: string | null | undefined): number {
  if (!fromIso) return 99999;
  const t = Date.parse(fromIso);
  if (!Number.isFinite(t)) return 99999;
  return (nowUtc() - t) / (1000 * 60 * 60 * 24);
}

/** Простая нормализация L2-distance к похожести [0..1]. */
function simFromL2(dist: number): number {
  return 1 / (1 + Math.max(0, dist));
}

/** Экспоненциальный «полураспад» свежести. */
function recencyBoost(days: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  return Math.exp(-Math.log(2) * (days / halfLifeDays));
}

/** Безопасно парсим hostname. */
function hostFromUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const raw = new URL(u).hostname.toLowerCase();
    const h = raw.startsWith("www.") ? raw.slice(4) : raw;
    return h || null;
  } catch {
    return null;
  }
}

/** Сопоставление домена с учётом поддоменов. */
function hostMatchesRule(host: string, rule: string): boolean {
  const r = rule.toLowerCase().replace(/^www\./, "");
  if (host === r) return true;
  return host.endsWith("." + r);
}

/** Собираем литерал вектора для pgvector: '[1,2,3]' */
function vectorLiteral(vec: number[]): string {
  const nums = vec.map((v) => (Number.isFinite(v) ? Number(v) : 0)).join(",");
  return `[${nums}]`;
}

export async function retrieveV2(p: RetrieveParams) {
  const started = Date.now();

  const nsMode = p.nsMode ?? "strict";
  const includeKinds = p.includeKinds ?? null;
  const includeSourceTypes = p.includeSourceTypes ?? null;

  const recency: RecencyOptions = {
    enabled: p.recency?.enabled ?? true,
    halfLifeDays: p.recency?.halfLifeDays ?? 30,
    weight: p.recency?.weight ?? 0.2,
    usePublishedAt: p.recency?.usePublishedAt ?? false,
  };

  const topK = Math.max(1, Math.min(p.topK ?? 5, 1000));
  const candidateK = Math.max(topK, Math.min(p.candidateK ?? 200, 10000));
  const minSim = typeof p.minSimilarity === "number" ? clamp01(p.minSimilarity) : undefined;

  // 1) Эмбеддинг запроса
  const qEmb = await embedQuery(p.query);
  if (!Array.isArray(qEmb) || qEmb.length < 8) {
    throw new Error("embedQuery returned invalid vector");
  }
  const qvLiteral = vectorLiteral(qEmb); // "[…]"

  // 2) WHERE-условия
  const clauses: string[] = [];
  const params: any[] = [];

  if (nsMode === "prefix") {
    params.push(p.ns, `${p.ns}/%`);
    clauses.push(`(m.ns = $${params.length - 1} OR m.ns LIKE $${params.length})`);
  } else {
    params.push(p.ns);
    clauses.push(`m.ns = $${params.length}`);
  }

  params.push(p.slot);
  clauses.push(`m.slot = $${params.length}`);

  clauses.push(`m.embedding IS NOT NULL`);

  if (includeKinds && includeKinds.length) {
    params.push(includeKinds);
    clauses.push(`m.kind = ANY($${params.length})`);
  }
  if (includeSourceTypes && includeSourceTypes.length) {
    params.push(includeSourceTypes);
    clauses.push(`(m.metadata->>'source_type') = ANY($${params.length})`);
  }

  // 3) SQL кандидатов (вектор как $X::vector)
  params.push(qvLiteral);
  const idxVec = params.length;

  params.push(candidateK);
  const idxLimit = params.length;

  const text = `
    WITH params AS (
      SELECT $${idxVec}::vector AS qv
    )
    SELECT
      m.id, m.kind, m.ns, m.slot, m.content, m.metadata, m.created_at,
      (m.embedding <-> (SELECT qv FROM params)) AS dist,
      (1.0 / (1.0 + (m.embedding <-> (SELECT qv FROM params)))) AS sim_raw
    FROM memories m
    WHERE ${clauses.join(" AND ")}
    ORDER BY m.embedding <-> (SELECT qv FROM params)
    LIMIT $${idxLimit}
  `;

  let rows: Row[] = [];
  try {
    const r = await pool.query(text, params);
    rows = r.rows as Row[];
  } catch (e: any) {
    throw new Error(`SQL retrieve failed: ${e?.message || String(e)}`);
  }

  const candidates = rows.length;

  // 4) Доменный фильтр + скоринг со свежестью
  const allow = (p.domainFilter?.allow ?? []).map((s) => s.toLowerCase().replace(/^www\./, ""));
  const deny  = (p.domainFilter?.deny  ?? []).map((s) => s.toLowerCase().replace(/^www\./, ""));
  const useDomainFilter = allow.length > 0 || deny.length > 0;

  const filtered = rows.filter((r) => {
    if (!useDomainFilter) return true;
    const h = hostFromUrl(r?.metadata?.url);
    if (!h) return false;

    if (deny.length && deny.some((d) => hostMatchesRule(h, d))) return false;
    if (allow.length && !allow.some((a) => hostMatchesRule(h, a))) return false;

    return true;
  });

  const afterDomain = filtered.length;

  const scored = filtered
    .map((r) => {
      const sim = clamp01(simFromL2(r.dist));
      const ageIso =
        (recency.usePublishedAt ? r?.metadata?.published_at : null) ||
        r.created_at ||
        null;
      const ageDays = daysBetween(ageIso);
      const recent = recency.enabled ? recencyBoost(ageDays, recency.halfLifeDays) : 1;

      const alpha = clamp01(recency.weight);
      const score = (1 - alpha) * sim + alpha * recent;

      return { r, sim, recent, score };
    })
    .filter((x) => (minSim !== undefined ? x.sim >= minSim : true))
    .sort((a, b) => b.score - a.score);

  // ВАЖНО: ограничиваем именно здесь, после сортировки
  const matchesRaw = scored.slice(0, topK);

  const matches = matchesRaw.map(({ r, sim, recent, score }) => ({
    id: r.id,
    kind: r.kind,
    ns: r.ns,
    slot: r.slot,
    content: r.content,
    metadata: r.metadata,
    created_at: r.created_at,
    sim,
    rec: recent,
    score,
    sample: r.content?.slice(0, 240) ?? "",
  }));

  const filterInfo =
    useDomainFilter
      ? {
          allow: allow.length ? allow : undefined,
          deny: deny.length ? deny : undefined,
          candidatesBefore: candidates,
          candidatesAfter: afterDomain,
          dropped: Math.max(0, candidates - afterDomain),
        }
      : null;

  return {
    ok: true,
    took_ms: Date.now() - started,
    params: {
      ns: p.ns,
      slot: p.slot,
      query: p.query,
      topK,
      candidateK,
      nsMode,
      includeKinds,
      includeSourceTypes,
      minSimilarity: minSim,
      recency,
      domainFilter: p.domainFilter ?? null,
    },
    recencyEffective: { ...recency },
    candidates,                // сколько кандидатов до пост-фильтров
    returned: matches.length,  // сколько реально вернули (≤ topK)
    filterInfo,                // null если фильтр не применялся
    matches,
    debugVersion: "r2-domains-slice-v2",
  };
}
