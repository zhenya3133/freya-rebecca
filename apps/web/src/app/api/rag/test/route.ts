import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano"]);
const pick = (m?: string) =>
  m && ALLOWED.has(m)
    ? m
    : (process.env.RAG_MODEL && ALLOWED.has(process.env.RAG_MODEL!)
        ? process.env.RAG_MODEL!
        : "gpt-5-mini");

export async function POST(req: Request) {
  try {
    const { model } = (await req.json()) as { model?: string };
    const chosen = pick(model);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    // 1) Responses (корректный формат + опциональный prompt caching)
    try {
      const useCache = false; // можно включить при необходимости
      const params: OpenAI.ResponsesAPI.CreateParams = {
        model: chosen,
        instructions: "Answer concisely.",
        max_output_tokens: 20,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Say 'pong' only." }],
          },
        ],
      };
      const opts = useCache
        ? { headers: { "OpenAI-Beta": "prompt-caching-2024-07-31" } }
        : undefined;

      // @ts-ignore
      const r = await client.responses.create(params, opts);
      // @ts-ignore
      const text = (r as any).output_text || (r as any)?.content?.[0]?.text;
      return NextResponse.json({ ok: true, mode: "responses", model: chosen, text });
    } catch (e: any) {
      // 2) Фолбэк: Chat тем же id модели (без перехода на другие семейства)
      try {
        const base: any = {
          model: chosen,
          messages: [
            { role: "system", content: "Answer concisely." },
            { role: "user", content: "pong?" },
          ],
        };
        if (/^gpt-5/.test(chosen)) base.max_completion_tokens = 20;
        else base.max_tokens = 20;

        const r2 = await client.chat.completions.create(base);
        const text = r2?.choices?.[0]?.message?.content;
        return NextResponse.json({ ok: true, mode: "chat", model: chosen, text });
      } catch (e2: any) {
        return NextResponse.json(
          { ok: false, error: "llm_call_failed", model: chosen, detail: String(e2?.message ?? e2) },
          { status: 502 }
        );
      }
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
