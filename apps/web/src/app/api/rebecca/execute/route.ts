// apps/web/src/app/api/rebecca/execute/route.ts
import OpenAI from "openai";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type Body = {
  goal?: string;
  topK?: number;  // количество документов контекста
  ns?: string;    // namespace памяти
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL is not set");

    const body = (await req.json().catch(() => ({}))) as Body;
    const goal = (body.goal ?? "").trim();
    const ns   = (body.ns ?? "rebecca").trim() || "rebecca";
    const topK = clampInt(body.topK ?? Number(process.env.RAG_TOPK ?? 4), 1, 12);

    if (!goal) return jsonErr(400, "Provide 'goal' in request body");

    // 1) эмбеддинг цели
    const vec = await getEmbedding(goal);
    const vecParam = toVectorLiteral(vec);

    // 2) ближайший контекст из памяти с учётом ns
    // порядок: $1 = vector, $2 = ns, $3 = topK
    // оператор L2 '<->' под индекс vector_l2_ops
    const sql = `
      SELECT
        id,
        kind,
        content,
        created_at,
        (embedding <-> $1::vector) AS distance
      FROM memories
      WHERE metadata->>'ns' = $2
      ORDER BY distance ASC
      LIMIT $3::int
    `;
    const { rows } = await pool.query(sql, [vecParam, ns, topK]);

    const contextText = rows
      .map(
        (r: any, i: number) =>
          `[${i + 1}] ${r.kind} • d=${Number(r.distance).toFixed(3)}\n` +
          String(r.content ?? "").slice(0, 800)
      )
      .join("\n\n");

    // 3) генерируем план
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model  = process.env.REBECCA_MODEL || "gpt-4.1-mini";

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Ты помощник-стратег. Отвечай по-русски. Используй ТОЛЬКО данный контекст (если релевантен). " +
            "Если данных не хватает — честно скажи, что нужно уточнить."
        },
        {
          role: "user",
          content:
            `Цель: ${goal}\n\n` +
            `Контекст (источники из памяти, ближайшие по смыслу, ns=${ns}):\n` +
            (contextText || "(память пуста)") +
            `\n\nСформируй понятный план действий (короткие буллеты) и очень краткое резюме.`
        }
      ]
    });

    const plan  = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const usage: any = (completion as any).usage ?? null;
    const tokens =
      usage?.total_tokens ??
      ((usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)) ??
      null;

    return jsonOk({
      ns,
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
