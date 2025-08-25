import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { retrieveV2 } from "@/lib/retriever_v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL = (process.env.RAG_MODEL || "gpt-4o-mini").trim();

type Profile = "qa" | "json" | "code" | "list" | "spec";

const SYSTEMS: Record<Profile, string> = {
  qa:   "Ты — Rebecca. Отвечай ТОЛЬКО по предоставленным источникам. Кратко (5–7 строк). Помечай факты ссылками [#N] и в конце выведи строку 'Sources: [#...]'. Если данных не хватает — так и скажи.",
  json: "Ты — Rebecca. Если хватает данных — верни ТОЛЬКО валидный JSON (без Markdown, без комментариев, без текста до/после). Если данных не хватает — верни пустой JSON-массив [].",
  code: "Ты — Rebecca, инженер. Верни ТОЛЬКО один код-блок по указанному языку (без текста до/после). Если данных не хватает — верни минимальный компилируемый шаблон с TODO.",
  list: "Ты — Rebecca. Верни компактный маркированный список (Markdown).",
  spec: "Ты — Rebecca. Верни краткую структурированную спецификацию в Markdown: Цель, Входы, Шаги, Выходы."
};

function clamp(s: string, n = 1200) { return s.length > n ? s.slice(0, n) : s; }

function buildUser(profile: Profile, query: string, numbered: string[]) {
  return `Вопрос: ${query}\n\nИсточники:\n${numbered.join("\n\n------\n\n")}`;
}

async function askChat(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  maxTokens: number
) {
  const r = await client.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: Math.min(900, Number.isFinite(maxTokens) ? maxTokens : 700),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  } as any);
  const txt = r?.choices?.[0]?.message?.content ?? "";
  return (typeof txt === "string" ? txt : "").trim();
}

/** Вырезаем Markdown-кодблоки и оставляем чистый JSON-диапазон. */
function extractJsonText(raw: string): string {
  if (!raw) return raw;

  // 1) Если есть ```...```, берём внутренности первого блока
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) raw = fenced[1];

  // 2) Отсекаем всё до первой [ или { и всё после последней ] или }
  const startCandidates = [raw.indexOf("["), raw.indexOf("{")].filter(i => i >= 0);
  if (startCandidates.length) {
    const start = Math.min(...startCandidates);
    const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
    if (end > start) raw = raw.slice(start, end + 1);
  }

  // 3) На всякий случай отрежем любые постфиксы вида "Sources: ..."
  raw = raw.split(/\n\s*Sources:/i)[0];

  return raw.trim();
}

/** Безопасный парс JSON: возвращаем { ok, value?, error? } */
function tryParseJson(s: string): { ok: true, value: any } | { ok: false, error: string } {
  try {
    const val = JSON.parse(s);
    return { ok: true, value: val };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const {
      query,
      ns,
      fetchK = 24,
      topK = 10,
      minScore = 0.18,
      maxTokens = 450,
      slot = "staging",
      profile = "qa",
      codeLang = "typescript",
      debug = false
    }: {
      query: string; ns: string;
      fetchK?: number; topK?: number; minScore?: number; maxTokens?: number; slot?: string;
      profile?: Profile; codeLang?: string; debug?: boolean;
    } = body || {};

    if (!query || !ns) {
      return NextResponse.json({ ok: false, error: "query and ns are required" }, { status: 400 });
    }

    // 1) Ретрив
    const chunks = await retrieveV2({ ns, query, fetchK, topK, minScore, slot });
    if (!chunks.length) {
      const fallback =
        profile === "json" ? "[]" :
        profile === "code" ? `\`\`\`${codeLang}\n// Недостаточно близкого контекста\n\`\`\`` :
        "Недостаточно близкого контекста.";
      return NextResponse.json({
        ok: true, model: MODEL, mode: "none", answer: fallback, sources: [], matches: []
      });
    }

    // 2) Контекст + источники
    const numbered: string[] = [];
    const sources = chunks.map((c, i) => {
      const title = c.source?.title || c.source?.path || c.source?.url || c.id;
      numbered.push(`[#${i + 1}] ${title}\n${clamp(c.content)}`);
      return { n: i + 1, path: c.source?.path, url: c.source?.url, score: Number(c.final.toFixed(4)) };
    });

    // 3) System + User
    const sys =
      profile === "code" ? `${SYSTEMS.code} Язык: ${codeLang}.` :
      SYSTEMS[profile as Profile] || SYSTEMS.qa;
    const user = buildUser(profile as Profile, query, numbered);

    // 4) Вызов модели (4o-линейка)
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
      maxRetries: 0
    });
    let answer = await askChat(client, MODEL, sys, user, maxTokens);

    // 5) Post-process по профилю
    let payload: any = undefined;
    let payloadParseError: string | undefined;

    if (profile === "json") {
      const onlyJson = extractJsonText(answer);
      const parsed = tryParseJson(onlyJson);
      if (parsed.ok) {
        payload = parsed.value;
        answer = onlyJson;            // храним «чистую» строку JSON в answer
      } else {
        payload = [];                  // мягкий фолбэк
        payloadParseError = parsed.error;
        answer = "[]";
      }
    } else if (profile === "code") {
      // гарантируем ровно один fenced-блок
      const inner = answer.replace(/```[\s\S]*?```/g, "").trim() || answer.trim();
      answer = "```" + codeLang + "\n" + inner.replace(/^```+|```+$/g, "").trim() + "\n```";
    }
    // для qa/list/spec — answer идёт как есть

    const matches = chunks.slice(0, 3).map(c => ({
      id: c.id, path: c.source?.path, url: c.source?.url,
      score: Number(c.final.toFixed(4)), preview: clamp(c.content, 500)
    }));

    return NextResponse.json({
      ok: true,
      model: MODEL,
      mode: "ok",
      profile,
      answer,
      ...(profile === "json" ? { payload, payloadParseError } : {}),
      sources,
      matches,
      ...(debug ? { debug: [{ model: MODEL, profile, len: answer.length }] } : {})
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
