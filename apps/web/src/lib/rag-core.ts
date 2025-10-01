// apps/web/src/lib/rag-core.ts
import OpenAI from "openai";
import { q } from "@/lib/db";
import type { ModelParams } from "@/lib/profile-runtime";

const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";
const CHAT_MODEL  = process.env.CHAT_MODEL  || "gpt-4o-mini";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function toVecLiteral(v: number[], frac = 6) {
  return "[" + v.map((x) => Number(x).toFixed(frac)).join(",") + "]";
}

export type Match = {
  id: string;
  ns: string;
  score: number;       // 0..1 (чем выше, тем ближе)
  content: string;
  source?: any;
  path?: string;
  preview?: string;
};

export type BuildOptions = {
  ns: string;
  query: string;
  topK?: number;       // default 8
  minScore?: number;   // default 0.35
  params?: ModelParams;
  model?: string;      // default CHAT_MODEL
};

/** Получить похожие куски из таблицы chunks (cosine similarity). */
export async function retrieveMatches(ns: string, query: string, topK = 8): Promise<Match[]> {
  const emb = await openai.embeddings.create({ model: EMBED_MODEL, input: query });
  const vec = toVecLiteral(emb.data[0].embedding as unknown as number[], 6);

  const rows = await q(
    `
    select id, ns, slot, content, source,
           1 - (embedding <=> $1::vector) as score
    from chunks
    where ns = $2
    order by embedding <=> $1::vector
    limit $3
    `,
    [vec, ns, topK]
  );

  const res: Match[] = rows.map((row: any) => ({
    id: row.id,
    ns: row.ns,
    score: Number(row.score ?? 0),
    content: String(row.content ?? ""),
    source: row.source ?? undefined,
    path: row.source?.title || row.source?.path,
    preview: String(row.content ?? "").slice(0, 400),
  }));
  return res;
}

/** Скомпоновать ответ модели с учётом профиля и параметров. */
export async function buildRagAnswer(
  opts: BuildOptions & { system: string }
): Promise<{
  model: string;
  answer: string;
  sources: Array<{ n: number; path?: string; score: number }>;
  matches: Array<{ id: string; path?: string; score: number; preview: string }>;
  mode: "ok" | "none";
}> {
  const topK = typeof opts.topK === "number" ? Math.max(1, Math.min(32, opts.topK)) : 8;
  const minScore = typeof opts.minScore === "number" ? opts.minScore : 0.35;
  const model = opts.model || CHAT_MODEL;

  const matches = await retrieveMatches(opts.ns, opts.query, topK);
  const strong = matches.filter((m) => m.score >= minScore);

  if (strong.length === 0) {
    return {
      model,
      answer: "Недостаточно близкого контекста.",
      sources: [],
      matches: matches.map((m) => ({
        id: m.id, path: m.path, score: m.score, preview: m.preview || ""
      })),
      mode: "none",
    };
  }

  const contextBlocks = strong
    .map((m, i) => `[#${i + 1}] score=${m.score.toFixed(3)} path=${m.path || ""}\n${m.content}`)
    .join("\n\n---\n\n");

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: opts.system || "Ты — помощник. Отвечай кратко и по делу." },
    { role: "user", content:
`Вопрос: ${opts.query}

Контекст (источники, пронумерованы):
${contextBlocks}

Требования:
- Отвечай кратко и по делу.
- Ссылайся на источники в конце формата "Sources: [#n, #m]".
- Если контекста недостаточно — напиши: "Недостаточно близкого контекста."`
    }
  ];

  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: opts.params?.temperature,
    top_p:       opts.params?.top_p,
    max_tokens:  opts.params?.max_tokens,
  });

  const answer = completion.choices?.[0]?.message?.content?.trim() || "";

  return {
    model,
    answer,
    sources: strong.map((m, i) => ({ n: i + 1, path: m.path, score: m.score })),
    matches: matches.map((m) => ({
      id: m.id, path: m.path, score: m.score, preview: m.preview || ""
    })),
    mode: "ok",
  };
}
