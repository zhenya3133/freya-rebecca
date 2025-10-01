import { NextResponse } from "next/server";
import OpenAI from "openai";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED = new Set(["gpt-4o-mini", "gpt-4o"]);

export async function POST(req: Request) {
  try {
    const { model = "gpt-4o-mini", text = "ping", n = 5 } =
      await req.json().catch(() => ({}));

    if (!ALLOWED.has(model)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_model", allowed: [...ALLOWED] },
        { status: 400 }
      );
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const r = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: text }],
      max_tokens: Math.max(16, Math.min(128, n * 16)),
    });

    const out = r.choices?.[0]?.message?.content?.trim() || "";
    return NextResponse.json({ ok: true, model, out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
