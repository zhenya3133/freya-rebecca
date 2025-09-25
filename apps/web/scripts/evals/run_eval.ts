// apps/web/scripts/evals/run_eval.ts
import fs from "node:fs/promises";
import path from "node:path";

type Case = {
  q: string;
  // подсказка, как мы считаем "попадание"
  must_url_substr?: string;

  // per-case опции запроса
  topK?: number;
  candidateK?: number;
  minSimilarity?: number;
  nsMode?: "strict" | "prefix";
  domainAllow?: string[];      // НОВОЕ: allow-домены для этого кейса
  domainDeny?: string[];       // опционально
};

type RetrieveReq = {
  q: string;
  ns: string;
  slot: string;
  topK: number;
  candidateK: number;
  minSimilarity: number;
  nsMode: "strict" | "prefix";
  domainFilter?: { allow?: string[]; deny?: string[] };
};

const BASE = process.env.BASE || "http://localhost:3000";
const NS   = process.env.NS   || "rebecca/army/refs";
const SLOT = process.env.SLOT || "staging";
const CASES = process.env.EVAL_CASES || "apps/web/scripts/evals/sample_cases.jsonl";
const OUTMD = process.env.EVAL_REPORT || "apps/web/docs/evals/latest.md";

async function readJsonl(file: string): Promise<Case[]> {
  const abs = path.resolve(file);
  const raw = await fs.readFile(abs, "utf8");
  return raw
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

async function callRetrieve(req: RetrieveReq) {
  const res = await fetch(`${BASE}/api/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  const j = await res.json();
  if (!res.ok) {
    throw new Error(`retrieve HTTP ${res.status}: ${JSON.stringify(j)}`);
  }
  return j;
}

function metricHitAtK(ranks: number[]): number {
  // ranks: 1..K для попавших; 0 — промах
  const hits = ranks.filter(x => x > 0).length;
  return ranks.length ? hits / ranks.length : 0;
}

function metricMRR(ranks: number[]): number {
  let s = 0;
  for (const r of ranks) s += r > 0 ? 1 / r : 0;
  return ranks.length ? s / ranks.length : 0;
}

function mdReport(now: Date, ranks: number[], rows: Array<{q:string; rank:number; url?:string; urls:string[];}>) {
  const hitAtK = metricHitAtK(ranks);
  const mrr    = metricMRR(ranks);
  const lines: string[] = [];
  lines.push(`# Eval report`);
  lines.push(`Date: ${now.toISOString()}`);
  lines.push(`NS: \`${NS}\`, slot: \`${SLOT}\`, base: \`${BASE}\``);
  lines.push("");
  lines.push(`**Summary:** n=${ranks.length}, hit@k=${hitAtK.toFixed(3)}, MRR=${mrr.toFixed(3)}`);
  lines.push("");
  lines.push(`| # | query | rank | top URLs |`);
  lines.push(`|--:|-------|-----:|----------|`);
  rows.forEach((r, i) => {
    const show = r.urls.slice(0, 3).map(u => u.replace(/^https?:\/\//, "")).join("<br>");
    lines.push(`| ${i+1} | ${r.q} | ${r.rank || 0} | ${show} |`);
  });
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const cases = await readJsonl(CASES);
  const ranks: number[] = [];
  const rowsForMd: Array<{q:string; rank:number; url?:string; urls:string[];}> = [];

  for (const c of cases) {
    const req: RetrieveReq = {
      q: c.q,
      ns: NS,
      slot: SLOT,
      topK: c.topK ?? 5,
      candidateK: c.candidateK ?? Math.max(200, c.topK ?? 5),
      minSimilarity: c.minSimilarity ?? 0.0,
      nsMode: c.nsMode ?? "prefix",
    };
    if ((c.domainAllow && c.domainAllow.length) || (c.domainDeny && c.domainDeny.length)) {
      req.domainFilter = {};
      if (c.domainAllow?.length) req.domainFilter.allow = c.domainAllow;
      if (c.domainDeny?.length)  req.domainFilter.deny  = c.domainDeny;
    }

    const r = await callRetrieve(req);
    const items: Array<{url?: string}> = Array.isArray(r?.items) ? r.items : [];
    const urls = items.map(it => it?.url || "");

    // ранк первой ссылки, содержащей must_url_substr (если задан)
    let rank = 0;
    if (c.must_url_substr) {
      const needle = c.must_url_substr.toLowerCase();
      const idx = urls.findIndex(u => (u || "").toLowerCase().includes(needle));
      rank = idx >= 0 ? idx + 1 : 0;
    } else {
      // если критерий не задан — считаем попаданием, если вообще есть хоть одна ссылка
      rank = urls.length > 0 ? 1 : 0;
    }

    ranks.push(rank);
    rowsForMd.push({ q: c.q, rank, url: urls[rank-1], urls });
  }

  const now = new Date();
  const out = { n: ranks.length, hitAtK: metricHitAtK(ranks), mrr: metricMRR(ranks) };
  console.log(JSON.stringify(out, null, 2));

  // markdown отчёт
  const md = mdReport(now, ranks, rowsForMd);
  await fs.mkdir(path.dirname(OUTMD), { recursive: true });
  await fs.writeFile(OUTMD, md, "utf8");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
