// apps/web/src/app/api/rebecca/execute/route.ts
import OpenAI from "openai";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type Body = {
  goal?: string;
  topK?: number;          // необязательный оверрайд количества документов из памяти
};

export async function POST(req: Request) {
  try {
    // --- валидация окружения ---
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL is not set");

    // --- парсим вход ---
    const body = (await req.json().catch(() => ({}))) as Body;
    const goal = (body.goal ?? "").trim();
    if (!goal) return jsonErr(400, "Provide 'goal' in request body");

    // сколько брать контекста из памяти
    const topK = clampInt(body.topK ?? Number(process.env.RAG_TOPK ?? 4), 1, 12);

    // --- 1) эмбеддинг цели ---
    const vec      = await getEmbedding(goal);  // number[]
    const vecParam = toVectorLiteral(vec);      // строка вида: [0.123,-0.045,...]

    // --- 2) поиск ближайшего контекста в memories ---
    // Для индекса ivfflat(... vector_l2_ops) используем L2-оператор '<->'
    const sql = `
      SELECT
        id,
        kind,
        content,
        created_at,
        (embedding <-> $1::vector) AS distance
      FROM memories
      ORDER BY distance ASC
      LIMIT $2
    `;

    let rows: any[] = [];
    try {
      const res = await pool.query(sql, [vecParam, topK]);
      rows = res.rows ?? [];
    } catch (dbErr: any) {
      return jsonErr(
        500,
        `DB query failed: ${dbErr?.message ?? dbErr}. ` +
        `Ensure table 'memories' exists and pgvector ops match ('<->' for vector_l2_ops).`
      );
    }

    // компактный контекст (чтобы не раздувать промпт)
    const contextText = rows
      .map(
        (r: any, i: number) =>
          `[${i + 1}] ${r.kind} • d=${Number(r.distance).toFixed(3)}\n` +
          String(r.content ?? "").slice(0, 800)
      )
      .join("\n\n");

    // --- 3) генерация плана с учётом контекста ---
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model  = process.env.REBECCA_MODEL || "gpt-4.1-mini";

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Ты помощник-стратег. Отвечай по-русски. Используй ТОЛЬКО переданный контекст. " +
            "Если данных не хватает — скажи, что нужно уточнить."
        },
        {
          role: "user",
          content:
            `Цель: ${goal}\n\n` +
            `Контекст (ближайшие по смыслу фрагменты памяти):\n` +
            (contextText || "(память пуста)") +
            `\n\nСформируй понятный план действий короткими буллетами и очень краткое резюме.`
        }
      ]
    });

    const plan   = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const usage: any = (completion as any).usage ?? null;
    const tokens =
      usage?.total_tokens ?? ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)) ?? null;

    // --- 4) возвращаем результат + что попало в контекст (для отладки/визуализации) ---
    return jsonOk({
      model,
      tokens,
      usage,
      plan,
      context_used: rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        distance: Number(r.distance),
        created_at: r.created_at
      }))
    });
  } catch (e: any) {
    console.error("rebecca/execute error:", e);
    return jsonErr(500, String(e?.message ?? e));
  }
}

/* ---------- utils ---------- */
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}
