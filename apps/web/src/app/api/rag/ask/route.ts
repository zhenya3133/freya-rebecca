// apps/web/src/app/api/rag/ask/route.ts
import OpenAI from "openai";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type AskBody = { query?: string; topK?: number };

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL is not set");

    const body = (await req.json().catch(() => ({}))) as AskBody;
    const query = (body.query ?? "").trim();
    const topK  = clampInt(body.topK ?? 4, 1, 8);
    if (!query) return jsonErr(400, "Provide 'query' in request body");

    // 1) эмбеддинг вопроса
    const vec = await getEmbedding(query);
    const vecParam = toVectorLiteral(vec); // "[0.1,0.2,...]"

    // 2) поиск ближайших фрагментов в памяти
    // ВНИМАНИЕ: у нас индекс vector_l2_ops -> используем оператор L2 '<->'.
    // Также упрощаем ORDER BY (без алиаса) — это надёжнее на некоторых версиях PG.
    const sql = `
      SELECT
        id,
        kind,
        content,
        metadata,
        created_at,
        (embedding <-> $1::vector) AS distance
      FROM memories
      ORDER BY embedding <-> $1::vector
      LIMIT $2
    `;

    let rows: any[] = [];
    try {
      const res = await pool.query(sql, [vecParam, topK]);
      rows = res.rows ?? [];
    } catch (dbErr: any) {
      // вернём аккуратную ошибку с подсказкой
      return jsonErr(
        500,
        `DB query failed: ${dbErr?.message ?? dbErr}. ` +
        `Check pgvector ops/operator match (we use L2 '<->') and that table 'memories' exists.`
      );
    }

    const context = rows
      .map((r, i) => `[${i + 1} ${r.kind} • d=${Number(r.distance).toFixed(4)}]\n${r.content}`)
      .join("\n\n");

    // 3) вызываем модель с контекстом
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model  = process.env.RAG_MODEL || "gpt-4.1-mini";

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Ты ассистент. Отвечай по-русски. Используй исключительно данный контекст. " +
            "Если данных не хватает — скажи, чего не хватает.",
        },
        {
          role: "user",
          content: `Вопрос: ${query}\n\nКонтекст:\n${context || "(память пуста)"}\n\nДай краткий ответ и список шагов.`,
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    return jsonOk({
      query,
      model,
      answer,
      sources: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        distance: Number(r.distance),
        created_at: r.created_at,
        preview: String(r.content ?? "").slice(0, 200),
      })),
    });
  } catch (e: any) {
    console.error("RAG /ask error:", e);
    return jsonErr(500, String(e?.message ?? e));
  }
}

// helpers
function jsonOk(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
function jsonErr(status: number, message: string) {
  return jsonOk({ error: message }, status);
}
function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}
