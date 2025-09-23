// apps/web/src/lib/retriever_v2.ts
import { pool } from "@/lib/pg";
import { embedQuery } from "@/lib/embeddings";
import {
  RetrieveRequest,
  RetrieveResponse,
  RetrieveItem,
  clamp,
} from "@/lib/retrieval-contract";
import { matchesDomain } from "@/lib/domain_filter";

const ALPHA = Number(process.env.RETRIEVE_ALPHA ?? 0.85);
const BETA = Number(process.env.RETRIEVE_BETA ?? 0.15);
const HALF_LIFE_DAYS = Number(process.env.RETRIEVE_T_HALF ?? 180);

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
  snippet: string | null;
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

  // host = нижний регистр хоста из url (если url валидна)
  // regexp_replace берёт первую группу хоста
  const hostExpr = `lower(NULLIF(regexp_replace(url, '^https?://([^/]+).*$', '\\1'), ''))`;

  if (df?.allow && df.allow.length) {
    const allowOrs: string[] = [];
    for (const d of df.allow) {
      const dom = d.toLowerCase().trim();
      // host = d  OR  host LIKE '%.d'
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

  // заменим префиксы $AL/$DN на обычные $1,$2,... когда приклеим к общему массиву
  return { clause: clauses.length ? clauses.join(" AND ") : "", rawParams: params };
}

export async function retrieveV2(req: RetrieveRequest): Promise<RetrieveResponse> {
  // калибровка чисел
  const candidateK = clamp(req.candidateK, Math.max(1, req.topK), 1000);
  const topK = clamp(req.topK, 1, 50);

  // эмбеддинг запроса
  const qvec = await embedQuery(req.q);

  // ns-фильтр
  const nsExact = req.ns;
  const nsLike = `${req.ns}/%`;
  const whereNs =
    req.nsMode === "strict"
      ? `ns = $2`
      : `(ns = $2 OR ns LIKE $3)`;

  // доменные предикаты — если есть allow/deny, ограничим кандидатов уже в SQL
  const { clause: domainClauseRaw, rawParams: domainParamsRaw } = buildDomainSQL(req.domainFilter);

  // строим основной текст запроса с «дыркой» под домен
  const base = `
    SELECT
      id, ns, slot, url, title, snippet,
      COALESCE(to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), NULL) AS published_at,
      source_type, kind, metadata,
      (1 - (embedding <=> $VEC::vector)) AS sim
    FROM chunks
    WHERE slot = $1
      AND ${whereNs}
      ${domainClauseRaw ? `AND (${domainClauseRaw})` : ``}
    ORDER BY embedding <=> $VEC::vector ASC
    LIMIT $LIM
  `;

  // собираем параметры в правильном порядке и пронумеровываем плейсхолдеры
  // шаблонные маркеры: $VEC, $LIM, $ALn/$DNn — заменим на обычные $1..$N
  const params: any[] = [];

  // $1, $2, ($3 если prefix)
  params.push(req.slot, nsExact);
  let text = base;

  if (req.nsMode !== "strict") {
    params.push(nsLike);
  } else {
    // убираем $3 из текста
    text = text.replace("ns LIKE $3", "/* nsLike omitted in strict */ TRUE");
  }

  // доменные параметры
  for (const p of domainParamsRaw) params.push(p);

  // подставим $VEC и $LIM в конец массива
  params.push(`[${qvec.join(",")}]`);
  params.push(candidateK);

  // теперь нужно перенумеровать плейсхолдеры по порядку:
  // $1..$N уже заняты, а $VEC и $LIM — символические; также $ALn/$DNn нужно заменить.
  // Сформируем мапу замен:
  let idx = 1;
  const replace = (s: string) => {
    // порядок: slot($1), nsExact($2), nsLike($3?) уже на месте, так что найдём спец-теги
    // пронумеруем AL/DN по порядку появления
    let t = s;
    // AL/DN
    const aldn = t.match(/\$A[L]\d+|\$D[N]\d+/g) || [];
    for (const tag of aldn) {
      // вычислим номер параметра этого тэга в массиве:
      // это всё, что идёт после базовых (slot/ns[/nsLike])
      // проще: пройдём по строке и заменим по очереди на $k, инкрементируя счётчик,
      // но нам нужно не задеть уже существующие $1/$2/$3.
    }
    return t;
  };

  // Проще: соберём текст заново с нумерацией через шаблон
  // Строим список условий заново, зная точные индексы
  const startCount = params.length - 2 - domainParamsRaw.length - (req.nsMode !== "strict" ? 3 : 2);
  // но это излишне сложно. Пойдём проще: не использовать символические плейсхолдеры.

  // --- ПРОЩЕ И НАДЁЖНЕЕ: сформируем текст динамически со стандартной нумерацией ---

  const whereParts: string[] = [`slot = $1`, req.nsMode === "strict" ? `ns = $2` : `(ns = $2 OR ns LIKE $3)`];
  let next = req.nsMode === "strict" ? 3 : 4;

  if (domainClauseRaw) {
    // пересоберём доменный блок с обычной нумерацией
    // domainParamsRaw идёт парами (value, %.value)
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
        params.splice(params.length - 2, 0); // no-op; мы позже добавим сами
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
    whereParts.push(parts.join(" AND "));
  }

  // теперь окончательный текст
  const finalSQL = `
    SELECT
      id, ns, slot, url, title, snippet,
      COALESCE(to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), NULL) AS published_at,
      source_type, kind, metadata,
      (1 - (embedding <=> $${next}::vector)) AS sim
    FROM chunks
    WHERE ${whereParts.join(" AND ")}
    ORDER BY embedding <=> $${next}::vector ASC
    LIMIT $${next + 1}
  `;

  // ПЕРЕСОБИРАЕМ params последовательно:
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

  // пост-фильтры (на случай deny/allow без SQL — но мы уже сузили allow в SQL)
  const afterSim: Row[] = rows.filter((r: Row) => r.sim >= req.minSimilarity);
  const afterDomain: Row[] = afterSim.filter((r: Row) => matchesDomain(r.url, req.domainFilter));

  // скоринг + topK
  const mapped: RetrieveItem[] = afterDomain.map((r: Row): RetrieveItem => {
    const score = ALPHA * r.sim + BETA * timeDecay(r.published_at);
    return {
      id: r.id,
      ns: r.ns,
      slot: r.slot,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      score,
      publishedAt: r.published_at,
      sourceType: r.source_type,
      kind: r.kind,
      metadata: r.metadata ?? {},
    };
  });

  const items: RetrieveItem[] = mapped
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);

  const filterInfo = {
    nsMode: req.nsMode,
    candidateK,
    minSimilarity: req.minSimilarity,
    droppedAfterSimilarity: rows.length - afterSim.length,
    droppedAfterDomain: afterSim.length - afterDomain.length,
    domainAllow: req.domainFilter?.allow ?? [],
    domainDeny: req.domainFilter?.deny ?? [],
  };

  return { items, filterInfo, debugVersion: "rc-v1" };
}
