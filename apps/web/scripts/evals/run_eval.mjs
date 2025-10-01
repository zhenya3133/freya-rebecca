// Node >=18 (встроенный fetch). Читает JSONL кейсы, бьет /api/retrieve, считает hit@k и MRR.
// BASE берется из env или дефолт http://localhost:3000
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE = process.env.BASE?.trim() || "http://localhost:3000";
const CASES = process.env.CASES?.trim() ||
  path.join(__dirname, "sample_cases.jsonl");
const OUT_MD = process.env.OUT_MD?.trim() ||
  path.resolve(__dirname, "../../../docs/evals/latest.md");

// маленький помощник: читать JSONL
async function readJsonl(file) {
  const txt = await fs.readFile(file, "utf8");
  return txt.split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch (e) {
      throw new Error(`JSONL parse error at line ${i+1}: ${e.message}`);
    }
  });
}

// одно обращение к /api/retrieve
async function retrieve({ q, ns, slot, k = 5, candidateK = 500 }) {
  const body = {
    q, ns, slot,
    topK: k, candidateK,
    minSimilarity: 0.0,
    nsMode: "prefix",
  };
  const r = await fetch(`${BASE}/api/retrieve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`retrieve ${r.status} ${r.statusText}: ${t.slice(0,200)}`);
  }
  return await r.json();
}

// проверяем «успех» кейса
function judge(caseItem, items) {
  const k = caseItem.k ?? 5;
  const urls = items.map(x => x.url || "");
  // критерии: anyOfDomains ИЛИ substring ИЛИ регэкспы (любой, если указан)
  const anyOfDomains = Array.isArray(caseItem.anyOfDomains) ? caseItem.anyOfDomains : [];
  const substr = Array.isArray(caseItem.mustContain) ? caseItem.mustContain : [];
  const regexes = Array.isArray(caseItem.mustMatch) ? caseItem.mustMatch.map(s => new RegExp(s)) : [];

  // функция попадания для одного url
  const okUrl = (u) => {
    if (!u) return false;
    if (anyOfDomains.length) {
      try {
        const h = new URL(u).hostname.toLowerCase();
        if (anyOfDomains.some(d => h === d || h.endsWith(`.${d}`))) return true;
      } catch{}
    }
    if (substr.length && substr.some(s => u.includes(s))) return true;
    if (regexes.length && regexes.some(rx => rx.test(u))) return true;
    return false;
  };

  // hit@k
  const topK = urls.slice(0, k);
  const hit = topK.some(okUrl) ? 1 : 0;

  // MRR (reciprocal rank первого совпадения)
  let rr = 0;
  for (let i = 0; i < topK.length; i++) {
    if (okUrl(topK[i])) { rr = 1 / (i + 1); break; }
  }

  // индекс первого совпадения (для отчета)
  let firstIdx = -1;
  for (let i = 0; i < topK.length; i++) {
    if (okUrl(topK[i])) { firstIdx = i; break; }
  }

  return { hit, rr, firstIdx, topKUrls: topK };
}

async function main() {
  const cases = await readJsonl(CASES);
  if (!cases.length) throw new Error("no cases in JSONL");

  const results = [];
  for (const c of cases) {
    const ns = c.ns || process.env.NS;
    const slot = c.slot || process.env.SLOT || "staging";
    if (!ns) throw new Error("case missing ns (or export NS=...)");

    const res = await retrieve({ q: c.q, ns, slot, k: c.k ?? 5, candidateK: c.candidateK ?? 500 });
    const judgeRes = judge(c, res.items || []);
    results.push({ case: c, judge: judgeRes });
  }

  const n = results.length;
  const hitAtK = results.reduce((s, r) => s + r.judge.hit, 0) / n;
  const mrr   = results.reduce((s, r) => s + r.judge.rr, 0) / n;

  // печать в консоль (кратко)
  console.log(JSON.stringify({
    n, hitAtK: Number(hitAtK.toFixed(4)), mrr: Number(mrr.toFixed(4))
  }, null, 2));

  // отчёт в Markdown
  const lines = [];
  lines.push(`# Retrieval Eval (RC v1)`);
  lines.push(`Base: \`${BASE}\``);
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(``);
  lines.push(`**Cases:** ${n}`);
  lines.push(`**hit@k:** ${hitAtK.toFixed(4)}`);
  lines.push(`**MRR:** ${mrr.toFixed(4)}`);
  lines.push(``);
  lines.push(`| # | q | k | hit | rr | first_idx | topK urls |`);
  lines.push(`|---|---|---:|---:|---:|---:|---|`);
  results.forEach((r, i) => {
    const { q, k } = { q: r.case.q, k: r.case.k ?? 5 };
    const { hit, rr, firstIdx, topKUrls } = r.judge;
    lines.push(`| ${i+1} | ${q.replace(/\|/g,"\\|")} | ${k} | ${hit} | ${rr.toFixed(3)} | ${firstIdx} | ${topKUrls.map(u=>u||"-").join("<br>")} |`);
  });
  lines.push(``);
  await fs.mkdir(path.dirname(OUT_MD), { recursive: true });
  await fs.writeFile(OUT_MD, lines.join("\n"), "utf8");
}

main().catch(err => { console.error(err); process.exit(1); });
