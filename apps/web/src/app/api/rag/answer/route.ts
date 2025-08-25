// apps/web/src/app/api/rag/answer/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { retrieveV2 } from "@/lib/retriever_v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ——— Модели: только 4o-линейка ———
const PRIMARY = (process.env.RAG_MODEL || "gpt-4o-mini").trim();
const FAMILY  = ["gpt-4o-mini", "gpt-4o"];
const ALLOWED = new Set(FAMILY);

const SYSTEM =
  "Ты — Rebecca. Отвечай ТОЛЬКО по предоставленным источникам. " +
  "Если данных не хватает — так и скажи. Кратко (5–7 строк). " +
  "Помечай факты ссылками [#N] и в конце выведи 'Sources:'.";

function clamp(s: string, n = 1200) { return s.length > n ? s.slice(0, n) : s; }
function tokensKV(maxTokens: number) {
  const n = Math.min(900, Number.isFinite(maxTokens) ? maxTokens : 700);
  // Для 4o используем классический max_tokens
  return { max_tokens: n } as any;
}

function ensureText(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x.trim();
  if (Array.isArray(x)) {
    return x.map(p => {
      if (typeof p === "string") return p;
      if (p && typeof p.text === "string") return p.text;
      if (p && p.content) return ensureText(p.content);
      return "";
    }).filter(Boolean).join("\n").trim();
  }
  if (x && typeof x === "object") {
    if (typeof (x as any).text === "string") return (x as any).text.trim();
    if ((x as any).content) return ensureText((x as any).content);
    if ((x as any).message?.content) return ensureText((x as any).message.content);
  }
  return String(x ?? "").trim();
}

async function askChat(
  client: OpenAI, model: string, system: string, user: string, maxTokens: number, forceText = false
) {
  const params: any = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user + (forceText
          ? '\n\nЕсли информации в источниках недостаточно, верни строку: "Недостаточно данных по источникам." Обязательно верни хотя бы одну строку текста.'
          : "")
      }
    ],
    // Температуру не задаём — дефолта достаточно и стабильнее
    ...tokensKV(maxTokens),
  };
  const r = await client.chat.completions.create(params);
  const raw = r?.choices?.[0]?.message?.content ?? "";
  return ensureText(raw);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const {
      query, ns,
      fetchK = 24, topK = 10, minScore = 0.18,
      maxTokens = 450,
      model: override,
      slot = "staging",
      debug = false,
    } = body || {};

    if (!query || !ns) {
      return NextResponse.json({ ok: false, error: "query and ns are required" }, { status: 400 });
    }

    // 1) Ретрив
    const chunks = await retrieveV2({ ns, query, fetchK, topK, minScore, slot });
    if (!chunks.length) {
      return NextResponse.json({
        ok: true, model: override || PRIMARY, mode: "none",
        answer: "Недостаточно близкого контекста.",
        sources: [], matches: [],
      });
    }

    // 2) Контекст и источники
    const numbered: string[] = [];
    const sources = chunks.map((c, i) => {
      const title = c.source?.title || c.source?.path || c.source?.url || c.id;
      numbered.push(`[#${i + 1}] ${title}\n${clamp(c.content)}`);
      return { n: i + 1, path: c.source?.path, url: c.source?.url, score: Number(c.final.toFixed(4)) };
    });
    const user = `Вопрос: ${query}\n\nИсточники:\n${numbered.join("\n\n------\n\n")}`;

    // 3) LLM: только Chat (4o-линейка)
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS) || 60000,
      maxRetries: 0,
    });

    const tryModels = [...new Set(
      [override, PRIMARY, ...FAMILY].filter(Boolean)
    )].filter(m => ALLOWED.has(m as string)) as string[];

    let used = "", answer = "", lastErr = "";
    const dbg: any[] = [];

    async function tryAll(model: string) {
      try {
        const a1 = await askChat(client, model, SYSTEM, user, maxTokens, false);
        dbg.push({ model, mode: "chat1", len: a1?.length || 0 });
        if (a1) return a1;
      } catch (e: any) {
        lastErr = `${e?.status ?? ""} ${e?.message ?? e}`;
        dbg.push({ model, where: "chat1", err: lastErr });
      }

      try {
        const a2 = await askChat(client, model, SYSTEM, user, maxTokens, true);
        dbg.push({ model, mode: "chat2", len: a2?.length || 0 });
        if (a2) return a2;
      } catch (e: any) {
        lastErr = `${e?.status ?? ""} ${e?.message ?? e}`;
        dbg.push({ model, where: "chat2", err: lastErr });
      }

      return "";
    }

    for (const m of tryModels) {
      const a = await tryAll(m);
      if (a) { used = m; answer = a; break; }
    }

    // 4) Мягкий фолбэк на пустой ответ
    if (!answer) {
      used = used || (override || PRIMARY);
      const fallback =
        "Недостаточно близкого контекста для уверенного ответа. " +
        "См. источники ниже — проверь формулировку вопроса или дополни базу знаний.";
      return NextResponse.json({
        ok: true, model: used, mode: "fallback", answer: fallback, sources, matches: [],
        ...(debug ? { debug: dbg } : {}),
      });
    }

    const matches = chunks.slice(0, 3).map((c) => ({
      id: c.id,
      path: c.source?.path,
      url: c.source?.url,
      score: Number(c.final.toFixed(4)),
      preview: clamp(c.content, 500),
    }));

    return NextResponse.json({
      ok: true, model: used, mode: "ok", answer, sources, matches,
      ...(debug ? { debug: dbg } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
