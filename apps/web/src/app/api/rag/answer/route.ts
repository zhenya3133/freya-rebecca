import { NextResponse } from "next/server";
import OpenAI from "openai";
import { pool, withPgRetry } from "../../../../lib/db";
import { embedMany } from "../../../../lib/embeddings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Разрешаем только GPT-5 семейство. */
const ALLOWED = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano"]);
const norm = (s?: string) => (s ?? "").trim();

function pickModel(override?: string) {
  const b = norm(override);
  if (b && !ALLOWED.has(b)) {
    const list = Array.from(ALLOWED).join(", ");
    throw new Error(`unsupported_model: "${b}". Allowed: ${list}`);
  }
  const env = norm(process.env.RAG_MODEL);
  if (b) return b;
  if (env && ALLOWED.has(env)) return env;
  return "gpt-5-mini";
}

function clampSnippet(s: string, max = 1200) {
  return s.length > max ? s.slice(0, max) : s;
}

const SYSTEM_BRIEF =
  "You are a helpful assistant for RAG. Answer ONLY from the provided context. " +
  "Be concise (max 5–7 lines). If the answer is not in the context, say you don't have enough info. " +
  "Then output a bullet list 'Sources:' with [#N] and path/URL.";

/** Правильный вызов Responses API + (опц.) prompt caching. */
async function askResponses(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  useCache: boolean,
  maxTokens: number
) {
  // В Responses используем `instructions` для «system» и messages-формат для input.
  const params: OpenAI.ResponsesAPI.CreateParams = {
    model,
    instructions: system,
    max_output_tokens: maxTokens,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: user,
            ...(useCache ? { cache_control: { type: "ephemeral" } as any } : {}),
          },
        ],
      },
    ],
  };

  // ВАЖНО: заголовок для prompt caching — во втором аргументе, а не в теле.
  const opts = useCache
    ? { headers: { "OpenAI-Beta": "prompt-caching-2024-07-31" } }
    : undefined;

  // не задаём temperature — у некоторых моделей семейства 5 поддерживается только дефолт.
  // @ts-ignore: тип опционального второго аргумента
  return client.responses.create(params, opts);
}

/** Фолбэк — Chat Completions тем же ID модели. */
async function askChat(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  maxTokens: number
) {
  const base: any = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Для GPT-5 нужно max_completion_tokens, для остальных — max_tokens.
  if (/^gpt-5/.test(model)) base.max_completion_tokens = maxTokens;
  else base.max_tokens = maxTokens;

  // temperature опускаем (некоторые 5-е модели принимают только дефолт).
  return client.chat.completions.create(base);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      query,
      ns = "rebecca",
      topK = 6,
      minScore = 0.12,
      maxTokens = 450,
      model: modelOverride,
    } = body as {
      query?: string;
      ns?: string;
      topK?: number;
      minScore?: number;
      maxTokens?: number;
      model?: string; // gpt-5 | gpt-5-mini | gpt-5-nano
    };

    if (!query) {
      return NextResponse.json(
        { ok: false, error: "query is required" },
        { status: 400 }
      );
    }

    let chosen: string;
    try {
      chosen = pickModel(modelOverride);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }

    // 1) Векторный поиск
    const [vec] = await embedMany([query]);
    const vecLit = `[${vec.join(",")}]`;

    const { rows } = await withPgRetry(() =>
      pool.query(
        `SELECT id, content,
                (metadata->>'path') AS path,
                (metadata->>'url')  AS url,
                (embedding <=> $1::vector) AS dist
         FROM memories
         WHERE kind = $2
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $3`,
        [vecLit, ns, Math.max(1, Math.min(20, topK))]
      )
    );

    const docs = rows
      .map((r) => {
        const dist = Number(r.dist);
        const score = 1 - Math.min(1, dist);
        return { id: r.id, path: r.path, url: r.url, content: String(r.content), score };
      })
      .filter((d) => d.score >= minScore);

    if (!docs.length) {
      return NextResponse.json({
        ok: true,
        model: chosen,
        mode: "none",
        answer: "Недостаточно близкого контекста для уверенного ответа.",
        sources: [],
        matches: [],
      });
    }

    // 2) Компоновка контекста
    const context = docs
      .map((d, i) => `[#${i + 1}] ${d.url || d.path || d.id}\n${clampSnippet(d.content)}`)
      .join("\n\n------\n\n");
    const user = `Question: ${query}\n\nContext:\n${context}`;

    const useCache = norm(process.env.PROMPT_CACHE) === "1";
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // 3) Пытаемся через Responses; при нефатальной ошибке — Chat тем же id модели
    let mode: "responses" | "chat" = "responses";
    let resp: any;
    try {
      resp = await askResponses(
        client,
        chosen,
        SYSTEM_BRIEF,
        user,
        useCache,
        Number.isFinite(maxTokens) ? maxTokens : 450
      );
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/(model.*not|unknown model|No such model|permission|access|not allowed|unsupported)/i.test(msg)) {
        return NextResponse.json(
          { ok: false, error: "model_unavailable", detail: msg, model: chosen },
          { status: 424 }
        );
      }
      mode = "chat";
      try {
        resp = await askChat(
          client,
          chosen,
          SYSTEM_BRIEF,
          user,
          Number.isFinite(maxTokens) ? maxTokens : 450
        );
      } catch (e2: any) {
        return NextResponse.json(
          { ok: false, error: "llm_call_failed", detail: String(e2?.message ?? e2), model: chosen },
          { status: 502 }
        );
      }
    }

    // 4) Извлекаем текст
    let answer: string | undefined;
    if (mode === "responses") {
      // у Responses SDK есть удобный геттер output_text
      // @ts-ignore
      answer =
        (resp as any).output_text ||
        (resp as any)?.content?.[0]?.text ||
        (resp as any)?.choices?.[0]?.message?.content;
    } else {
      answer = resp?.choices?.[0]?.message?.content;
    }
    if (!answer) answer = "(no answer)";

    const sources = docs.map((d, i) => ({
      n: i + 1,
      path: d.path,
      url: d.url,
      score: d.score,
    }));

    return NextResponse.json({
      ok: true,
      model: chosen,
      mode,
      answer,
      sources,
      matches: docs.slice(0, 3),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e), stack: e?.stack },
      { status: 500 }
    );
  }
}
