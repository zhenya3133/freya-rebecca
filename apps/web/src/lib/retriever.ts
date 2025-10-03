// apps/web/src/lib/retriever.ts
export type Vec = number[];
export type Candidate = {
  id: string;
  ns?: string;           // у нас это memories.kind
  content: string;
  embedding: Vec;
  score: number;         // 1 - distance
};

function dot(a: Vec, b: Vec){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function norm(a: Vec){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*a[i];return Math.sqrt(s);}
function cosine(a: Vec, b: Vec){const d=dot(a,b), n=norm(a)*norm(b);return n?d/n:0;}

/** MMR + отсев по minScore (score = 1 - distance) */
export function applyMMRwithThreshold(
  candidates: Candidate[], queryEmb: Vec, k=8, lambda=0.5, minScore=0.78
){
  let pool = candidates.filter(c => (c.score ?? 0) >= minScore);
  if (pool.length <= k) return pool;

  const selected: Candidate[] = [];
  while (selected.length < k && pool.length) {
    let best: Candidate | null = null, bestScore = -Infinity;
    for (const c of pool) {
      const rel = cosine(c.embedding, queryEmb);
      let red = 0;
      for (const s of selected) {
        const sim = cosine(c.embedding, s.embedding);
        if (sim > red) red = sim;
      }
      const mmr = lambda*rel - (1-lambda)*red;
      if (mmr > bestScore) { bestScore = mmr; best = c; }
    }
    if (!best) break;
    selected.push(best);
    pool = pool.filter(x => x !== best);
  }
  return selected;
}

/** Преобразование значения pgvector из Postgres в массив number[] */
export function parsePgVector(v: unknown): number[] {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    // формат типа "[0.1, 0.2, ...]"
    return v.replace(/[\[\]\s]/g, "").split(",").map(Number);
  }
  throw new Error("Unsupported pgvector representation");
}
