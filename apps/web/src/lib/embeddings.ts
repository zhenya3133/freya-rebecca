// apps/web/src/lib/embeddings.ts
import OpenAI from "openai";

/**
 * Модель эмбеддингов:
 * по умолчанию "text-embedding-3-small" (дешёво и достаточно для RAG).
 * Можно переопределить через .env.local: EMBED_MODEL=...
 */
const EMBED_MODEL = (process.env.EMBED_MODEL ?? "text-embedding-3-small").trim();

/** мягкий трим входа (на всякий случай) */
function trimForEmbed(s: string, maxChars = 8000) {
  const t = String(s ?? "");
  return t.length > maxChars ? t.slice(0, maxChars) : t;
}

/** небольшой backoff для транзиентных сбоев сети */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Создаём свежий клиент (как в emb-ping) — без лишних опций */
function makeClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    // оставим только timeout — это безопасно
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 45000),
  });
}

/** Эмбеддинг одной строки (ровно строка, не массив) с повторами */
export async function getEmbedding(text: string, model = EMBED_MODEL): Promise<number[]> {
  const input = trimForEmbed(text);
  let last: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await makeClient().embeddings.create({ model, input });
      return (res.data[0].embedding as unknown) as number[];
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      if (/timeout|ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN/i.test(msg) && attempt < 2) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

/**
 * Эмбеддинг массива строк: по одной строке за вызов.
 * Это на доли секунды медленнее, но исключает странности сериализации input.
 */
export async function embedMany(texts: string[], model = EMBED_MODEL): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    const s = trimForEmbed(t);
    let last: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await makeClient().embeddings.create({ model, input: s });
        out.push((res.data[0].embedding as unknown) as number[]);
        last = null;
        break;
      } catch (e: any) {
        last = e;
        const msg = String(e?.message ?? e);
        if (/timeout|ETIMEDOUT|ENETUNREACH|ECONNRESET|EAI_AGAIN/i.test(msg) && attempt < 2) {
          await sleep(350 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
    if (last) throw last;
  }
  return out;
}

/** Утилита для SQL-литерала */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
