import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { retrieveV2 } from "@/lib/retriever_v2";
import { getAppliedProfile } from "@/lib/profile-runtime";
import { writeLogSafe } from "@/lib/logs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL = (process.env.RAG_MODEL || "gpt-4o-mini").trim();

type SpecialProfile = "qa" | "json" | "code" | "list" | "spec";
type AnyProfileName = string;

const SYSTEMS: Record<SpecialProfile, string> = {
  qa:   "Ты — Rebecca. Отвечай ТОЛЬКО по предоставленным источникам. Кратко (5–7 строк). Помечай факты ссылками [#N] и в конце выведи строку 'Sources: [#...]'. Если данных не хватает — так и скажи.",
  json: "Ты — Rebecca. Если хватает данных — верни ТОЛЬКО валидный JSON (без Markdown, без комментариев, без текста до/после). Если данных не хватает — верни пустой JSON-массив [].",
  code: "Ты — Rebecca, инженер. Верни ТОЛЬКО один код-блок по указанному языку (без текста до/после). Если данных не хватает — верни минимальный компилируемый шаблон с TODO.",
  list: "Ты — Rebecca. Верни компактный маркированный список (Markdown).",
  spec: "Ты — Rebecca. Верни краткую структурированную спецификацию в Markdown: Цель, Входы, Шаги, Выходы."
};

function clamp(s: string, n = 1200) { return s.length > n ? s.slice(0, n) : s; }

function buildUser(query: string, numbered: string[]) {
  return `Вопрос: ${query}\n\nИсточники:\n${numbered.join("\n\n------\n\n")}`;
}

async function askChat(
  client: OpenAI,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  temperature = 0.2,
  top_p = 0.9
) {
  const r = await client.chat.completions.create({
    model,
    temperature,
    top_p,
    max_tokens: Math.min(900, Number.isFinite(maxTokens) ? maxTokens : 700),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  } as any);
  const txt = r?.choices?.[0]?.message?.content ?? "";
  return (typeof txt === "string" ? txt : "").trim();
}

function extractJsonText(raw: string): string {
  if (!raw) return raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) raw = fenced[1];
  const startCandidates = [raw.indexOf("["), raw.indexOf("{")].filter(i => i >= 0);
  if (startCandidates.length) {
    const start = Math.min(...startCandidates);
    const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
    if (end > start) raw = raw.slice(start, end + 1);
  }
  raw = raw.split(/\n\s*Sources:/i)[0];
  return raw.trim();
}

function sanitize(obj: any) {
  try {
    const j = JSON.stringify(obj, (_k, v) => {
      if (typeof v === "string") {
        if (/^sk-[a-z0-9]/i.test(v) || v.startsWith("rebecca_")) return "<redacted>";
      }
      return v;
    });
    return JSON.parse(j);
  } catch {
    return {};
  }
}

function asSpecial(name?: string): SpecialProfile | null {
  const n = (name || "").toLowerCase().trim();
  const all = ["qa","json","code","list","spec"] as SpecialProfile[];
  return (all.includes(n as any) ? (n as SpecialProfile) : null);
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let logId: string | null = null;

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
      profileName = "qa",
      codeLang = "typescript",
      // опциональные overrides
      temperature,
      top_p
    }: {
      query: string; ns: string;
      fetchK?: number; topK?: number; minScore?: number; maxTokens?: number; slot?: string;
      profileName?: AnyProfileName; codeLang?: string;
      temperature?: number; top_p?: number;
    } = body || {};

    if (!query || !ns) {
      return NextResponse.json({ ok: false, error: "query and ns are required" }, { status: 400 });
    }

    // 1) Ретрив
    const chunks = await retrieveV2({ ns, query, fetchK, topK, minScore, slot });
    if (!chunks.length) {
      const sp = asSpecial(profileName) || "qa";
      const fallback =
        sp === "json" ? "[]"
        : sp === "code" ? "```" + codeLang + "\n// Недостаточно близкого контекста\n```"
        : "Недостаточно близкого контекста.";

      // логируем «пустой» ответ
      logId = await writeLogSafe({
        kind: "rag.answer",
        ns, profile: sp,
        params: sanitize({ temperature, top_p, max_tokens: maxTokens }),
        request: sanitize({ ns, query, profile: sp, codeLang }),
        response: sanitize({ mode: "none", model: MODEL, answer: fallback, profile: sp, sources: [] })
      });

      return NextResponse.json({
        ok: true, model: MODEL, mode: "none", profile: sp, answer: fallback, sources: [], matches: [], logId
      });
    }

    // 2) Контекст + источники
    const numbered: string[] = [];
    const sources = chunks.map((c: any, i: number) => {
      const title = c.source?.title || c.source?.path || c.source?.url || c.id;
      numbered.push(`[#${i + 1}] ${title}\n${clamp(String(c.content || ""))}`);
      const score = typeof c.final === "number" ? c.final : (typeof c.score === "number" ? c.score : 0);
      return { n: i + 1, path: c.source?.path, url: c.source?.url, score: Number(score?.toFixed?.(4) ?? score ?? 0) };
    });

    // 3) Профиль: спец или из сидов
    const special = asSpecial(profileName);
    const client = new OpenAI();

    let system: string;
    let effectiveProfile: string;
    let effTemp = temperature;
    let effTopP = top_p;

    if (special) {
      system = special === "code" ? `${SYSTEMS.code} Язык: ${codeLang}.` : SYSTEMS[special];
      effectiveProfile = special;
      effTemp = effTemp ?? 0.2;
      effTopP = effTopP ?? 0.9;
    } else {
      const applied = await getAppliedProfile(profileName);
      system = applied.system || SYSTEMS.qa;
      effectiveProfile = applied.profileName || profileName || "qa";
      effTemp = effTemp ?? applied.params?.temperature ?? 0.2;
      effTopP = effTopP ?? applied.params?.top_p ?? 0.9;
    }

    // 4) Вызов модели
    const user = buildUser(query, numbered);
    let answer = await askChat(client, MODEL, system, user, maxTokens, effTemp, effTopP);

    if (special === "json") {
      // чистим до «голого» JSON-текста, но наружу всё равно возвращаем строку
      const extracted = extractJsonText(answer);
      answer = extracted || "[]";
    }

    // 5) Лог
    const payload = {
      ok: true,
      mode: "ok",
      model: MODEL,
      profile: effectiveProfile,
      answer,
      sources
    };

    logId = await writeLogSafe({
      kind: "rag.answer.guarded",
      ns,
      profile: effectiveProfile,
      params: sanitize({ temperature: effTemp, top_p: effTopP, max_tokens: maxTokens }),
      request: sanitize({ ns, query, profile: profileName, codeLang, fetchK, topK, minScore, slot }),
      response: sanitize(payload),
      meta: { ms: Date.now() - t0 }
    });

    return NextResponse.json({ ...payload, logId });

  } catch (e: any) {
    // safety-лог и понятный ответ
    try {
      await writeLogSafe({
        kind: "rag.answer.error",
        params: {},
        request: { route: "rag/answer-logged" },
        response: { error: String(e?.message ?? e), stack: String(e?.stack ?? "") }
      });
    } catch {}
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
