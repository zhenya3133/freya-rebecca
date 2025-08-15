// apps/web/src/app/api/rebecca/execute/route.ts
import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { goal } = await req.json();
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), { status: 500 });
    }
    if (!goal || typeof goal !== "string") {
      return new Response(JSON.stringify({ error: "Provide 'goal' as string" }), { status: 400 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Ты — Ребекка, мета-агент-инженер. Дай пошаговый план: Research → Synthesis → Architecture → Dev-Skeleton → Sales → Ops. Кратко и по делу."
        },
        { role: "user", content: `Цель: ${goal}` }
      ]
    });

    // @ts-ignore — удобный плоский текст ответа
    const plan = resp.output_text ?? "Нет текста в ответе модели.";
    return new Response(JSON.stringify({ plan }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" }

    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
}
