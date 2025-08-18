// apps/web/src/app/api/rag/ask/route.ts
import OpenAI from "openai";
import { pool } from "@/lib/db";
import { getEmbedding, toVectorLiteral } from "@/lib/embeddings";

export const runtime = "nodejs";

type AskBody = {
  query?: string;
  topK?: number;
  ns?: string; // namespace памяти
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) return jsonErr(500, "OPENAI_API_KEY is not set");
    if (!process.env.DATABASE_URL)   return jsonErr(500, "DATABASE_URL is not set");

    const body  = (await req.json().catch(() => ({}))) as AskBody;
    const query = (body.query ?? "").trim();
    const ns    = (body.ns ?? "rebecca").trim() || "rebecca";
    const topK  = clampInt(body.topK ?? Number(process.env.RAG_TOPK ?? 4), 1, 12);

    if (!query) return jsonErr(400, "Provide 'query' in request body");

    // 1) эмбеддинг запроса
    const vec = await getEmbedding(query);
    const vecParam = toVectorLiteral(vec); // строка "[...]" для $1::vector

    // 2) поиск ближайшего контекста в memories
    // порядок параметров: $1 = vector, $2 = ns, $3 = topK
    // ВАЖНО: индекс у вас vector_l2_ops → используем оператор L2 '<->'
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

    let rows: any[] = [];
    try {
      const res = await pool.query(sql, [vecParam, ns, topK]);
      rows = res.rows ?? [];
    } catch (dbErr: any) {
      return jsonErr(500, `DB query failed: ${dbErr?.message ?? dbErr}`);
    }

    const context = rows
      .map(
        (r: any, i: number) =>
          `[${i + 1} ${r.kind} • d=${Number(r.distance).toFixed(4)}]\n` +
          String(r.content ?? "").slice(0, 800)
      )
      .join("\n\n");

    // 3) ответ модели
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
            "Если данных не хватает — скажи, чего не хватает."
        },
        {
          role: "user",
          content:
            `Вопрос: ${query}\n\n` +
            `Контекст:\n${context || "(память пуста для выбранного ns)"}\n\n` +
            `Дай краткий ответ и список шагов.`
        }
      ]
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    return jsonOk({
      query,
      ns,
      model,
      answer,
      sources: rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        distance: Number(r.distance),
        created_at: r.created_at,
        preview: String(r.content ?? "").slice(0, 200)
      }))
    });
  } catch (e: any) {
    console.error("RAG /ask error:", e);
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
