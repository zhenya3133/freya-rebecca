import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = process.env.EMBED_MODEL || "text-embedding-3-small"; // 1536
const DIMS  = Number(process.env.EMBED_DIMS || 1536);

// Грубая оценка токенов (≈4 символа на токен)
function estimateTokens(s: string) {
  return Math.ceil((s?.length || 0) / 4);
}

// Жёсткие лимиты (чуть ниже серверных, с запасом)
const MAX_TOKENS_PER_REQ = 280_000;   // суммарно на batch
const MAX_ITEMS_PER_REQ  = 96;        // ограничим количество инпутов
const MAX_ITEM_TOKENS    = 8_000;     // per-input лимит модели (safe)

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!texts?.length) return [];

  // Разбиваем вход на батчи по сумме токенов и количеству элементов
  const batches: string[][] = [];
  let cur: string[] = [];
  let curTok = 0;

  const pushBatch = () => {
    if (cur.length) batches.push(cur), cur = [], curTok = 0;
  };

  for (const t of texts) {
    const tt = estimateTokens(t);
    if (tt > MAX_ITEM_TOKENS) {
      // отрежем очень длинные куски (защитный механизм)
      const safe = t.slice(0, MAX_ITEM_TOKENS * 4);
      cur.push(safe);
      curTok += Math.min(tt, MAX_ITEM_TOKENS);
    } else {
      cur.push(t);
      curTok += tt;
    }
    if (cur.length >= MAX_ITEMS_PER_REQ || curTok >= MAX_TOKENS_PER_REQ) pushBatch();
  }
  pushBatch();

  const out: number[][] = [];
  for (const b of batches) {
    const res = await client.embeddings.create({ model: MODEL, input: b });
    for (const row of res.data) {
      const v = row.embedding as unknown as number[];
      if (v.length !== DIMS) throw new Error(`Embedding dims mismatch: got ${v.length}, expected ${DIMS}`);
      out.push(v);
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedMany([text]);
  return v;
}
