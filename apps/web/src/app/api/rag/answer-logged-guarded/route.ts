import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { retrieveV2 } from "@/lib/retriever_v2";
import { appliedProfileFromRequest, mergeParams } from "@/lib/profile-runtime";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MODEL = (process.env.RAG_MODEL || "gpt-4o-mini").trim();
const MAX_PROMPT = 4000;

type Profile = "qa" | "json" | "code" | "list" | "spec";

const FORMAT_SYSTEMS: Record<Profile, string> = {
  qa:   "Отвечай ТОЛЬКО по предоставленным источникам. Кратко (5–7 строк). Помечай факты ссылками [#N] и в конце выведи строку 'Sources: [#...]'. Если данных не хватает — так и скажи.",
  json: "Если хватает данных — верни ТОЛЬКО валидный JSON (без Markdown, без комментариев, без текста до/после). Если данных не хватает — верни пустой JSON-массив [].",
  code: "Верни ТОЛЬКО один код-блок по указанному языку (без текста до/после). Если данных не хватает — верни минимальный компилируемый шаблон с TODO.",
  list: "Верни компактный маркированный список (Markdown).",
  spec: "Верни краткую структурированную спецификацию в Markdown: Цель, Входы, Шаги, Выходы."
};

function clamp(s: string, n = 1200) { return s.length > n ? s.slice(0, n) : s; }
function buildUser(_profile: Profile, query: string, numbered: string[]) {
  return `Вопрос: ${query}\n\nИсточники:\n${numbered.join("\n\n------\n\n")}`;
}

async function askChat(
  client: OpenAI, model: string, system: string, user: string,
  params: { temperature?: number; top_p?: number; max_tokens?: number }
) {
  const r = await client.chat.completions.create({
    model,
    temperature: typeof params.temperature === "number" ? params.temperature : 0.2,
    top_p:       typeof params.top_p       === "number" ? params.top_p       : undefined,
    max_tokens:  Math.min(
      900,
      Number.isFinite(params.max_tokens as number) ? (params.max_tokens as number) : 700
    ),
    messages: [{ role: "system", content: system }, { role: "user", content: user }]
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
function tryParseJson(s: string): { ok: true, value: any } | { ok: false, error: string } {
  try { return { ok: true, value: JSON.parse(s) }; }
  catch (e: any) { return { ok: false, error: String(e?.message ?? e) }; }
}
function redactSecrets(s: string) {
  return s.replace(/\bsk-[a-z0-9_\-]{10,}\b/gi, "sk-REDACTED");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const {
      query, ns,
      fetchK = 24, topK = 10, minScore = 0.18, maxTokens = 450, slot = "staging",
      profile = "qa", codeLang = "typescript", debug = false, model: bodyModel
    } = body || {};

    if (!query || !ns) {
      return NextResponse.json({ ok: false, error: "query and ns are required" }, { status: 400 });
    }
    if (String(query).length > MAX_PROMPT) {
      return new NextResponse(`Prompt too long: ${String(query).length} > ${MAX_PROMPT}`, { status: 400 });
    }

    const ap = await appliedProfileFromRequest(req, body);
    const fmt = profile === "code"
      ? `${FORMAT_SYSTEMS.code} Язык: ${codeLang}.`
      : (FORMAT_SYSTEMS[profile as Profile] || FORMAT_SYSTEMS.qa);
    const system = (ap.system && ap.system.trim()) ? `${ap.system.trim()}\n\n${fmt}` : fmt;

    const finalParams = mergeParams(ap.params, {
      temperature: typeof body?.temperature === "number" ? body.temperature : undefined,
      top_p:       typeof body?.top_p       === "number" ? body.top_p       : undefined,
      max_tokens:  typeof maxTokens         === "number" ? maxTokens        : undefined
    });

    const model = typeof bodyModel === "string" && bodyModel.trim() ? bodyModel.trim() : DEFAULT_MODEL;

    const safeTopK = Math.max(1, Math.min(16, Number(topK)));

    const chunks = await retrieveV2({ ns, query, fetchK, topK: safeTopK, minScore, slot });
    if (!chunks.length) {
      const fallback =
        profile === "json" ? "[]" :
        profile === "code" ? `\`\`\`${codeLang}\n// Недостаточно близкого контекста\n\`\`\`` :
        "Недостаточно близкого контекста.";
      return NextResponse.json({
        ok: true, model, mode: "none", profile: ap.profileName, answer: fallback, sources: [], matches: []
      });
    }

    const numbered: string[] = [];
    const sources = chunks.map((c, i) => {
      const title = c.source?.title || c.source?.path || c.source?.url || c.id;
      numbered.push(`[#${i + 1}] ${title}\n${clamp(c.content)}`);
      return { n: i + 1, path: c.source?.path, url: c.source?.url, score: Number(c.final.toFixed(4)) };
    });

    const user = buildUser(profile as Profile, query, numbered);

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
      maxRetries: 0
    });
    let answer = await askChat(client, model, system, user, finalParams);

    let payload: any = undefined;
    let payloadParseError: string | undefined;
    if (profile === "json") {
      const onlyJson = extractJsonText(answer);
      const parsed = tryParseJson(onlyJson);
      if (parsed.ok) { payload = parsed.value; answer = onlyJson; }
      else { payload = []; payloadParseError = parsed.error; answer = "[]"; }
    } else if (profile === "code") {
      const inner = answer.replace(/```[\s\S]*?```/g, "").trim() || answer.trim();
      answer = "```" + codeLang + "\n" + inner.replace(/^```+|```+$/g, "").trim() + "\n```";
    }

    const matches = chunks.slice(0, 3).map(c => ({
      id: c.id, path: c.source?.path, url: c.source?.url,
      score: Number(c.final.toFixed(4)), preview: clamp(c.content, 500)
    }));

    // лог
    const reqLog = JSON.parse(redactSecrets(JSON.stringify(body || {})));
    const resLog = JSON.parse(redactSecrets(JSON.stringify({
      model, profile: ap.profileName, mode: "ok", answer, sources
    })));
    const ins = await q(
      `insert into logs(kind, ns, profile, params, request, response, created_at)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb, now())
       returning id`,
      ["rag.answer.guarded", ns, ap.profileName, JSON.stringify(finalParams), JSON.stringify(reqLog), JSON.stringify(resLog)]
    );

    return NextResponse.json({
      ok: true,
      model,
      mode: "ok",
      profile: ap.profileName,
      answer,
      sources,
      matches,
      logId: ins.rows?.[0]?.id || null,
      ...(debug ? { debug: [{ model, profile: ap.profileName, len: answer.length, params: finalParams }] } : {})
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
