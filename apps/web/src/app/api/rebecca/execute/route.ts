// apps/web/src/app/api/rebecca/execute/route.ts
import { pool } from "@/lib/db";
import { getEmbedding } from "@/lib/embeddings";
export const runtime = "nodejs";

type SearchHit = {
  id: string;
  kind: string;
  content: string;
  metadata: any;
  created_at: string;
  distance: number;
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const topK = Number(body.topK ?? 5);
    const maxDistance = Number(body.maxDistance ?? 0.65); // порог релевантности

    if (!goal) {
      return json({ error: "Provide 'goal' as non-empty string" }, 400);
    }
    if (!process.env.OPENAI_API_KEY) {
      return json({ error: "OPENAI_API_KEY not set" }, 500);
    }
    if (!process.env.DATABASE_URL) {
      return json({ error: "DATABASE_URL not set" }, 500);
    }

    // 1) Получаем эмбеддинг запроса (цели)
    const queryVec = await getEmbedding(goal);

    // 2) Ищем релевантные фрагменты в памяти (семантический поиск)
    //    Префильтруем по kind='plan' и отсечём по distance (L2) через WHERE
    const searchSql = `
      SELECT id, kind, content, metadata, created_at,
             (embedding <-> $1::vector) AS distance
      FROM memories
      WHERE kind = 'plan'
      ORDER BY embedding <-> $1::vector
      LIMIT $2
    `;
    const { rows } = await pool.query<SearchHit>(searchSql, [queryVec, topK]);

    // применим ручной порог (чтобы мусор не попадал в контекст)
    const hits = rows.filter(r => Number(r.distance) <= maxDistance);

    // 3) Формируем system+user промпт с контекстом
    const contextBlock =
      hits.length === 0
        ? "No prior plans found in memory."
        : hits
            .map(
              (h, i) =>
                `# Memory ${i + 1} (id=${h.id}, distance=${h.distance.toFixed(
                  3
                )})\n${truncate(h.content, 1200)}`
            )
            .join("\n\n");

    const systemPrompt = [
      "You are Rebecca, a senior AI-ops strategist.",
      "Reuse relevant prior plans from memory when helpful.",
      "Output a clear, step-by-step plan with sections: Research, Synthesis, Architecture, Dev-Skeleton, Sales, Ops.",
      "Be concise, practical, and avoid repetition."
    ].join(" ");

    const userPrompt = [
      `Goal: ${goal}`,
      "",
      "Relevant prior knowledge:",
      contextBlock,
    ].join("\n");

    // 4) Вызов модели (chat completions)
    const model = body.model ?? "gpt-4o-mini";
    const completion = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!completion.ok) {
      const t = await completion.text();
      return json({ error: "OpenAI error", detail: t }, 502);
    }

    const data = await completion.json().catch(() => ({}));
    const plan: string =
      data?.choices?.[0]?.message?.content ?? "Не удалось получить план.";
    const usage = data?.usage ?? null;

    // 5) Вернём план + какие памяти использовали (для дебага/UI)
    return json({
      model,
      usage,
      plan,
      context_used: hits.map((h) => ({
        id: h.id,
        distance: h.distance,
      })),
    });
  } catch (e: any) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
}

// helpers
function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max) + "…";
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
