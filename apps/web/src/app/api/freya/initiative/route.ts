// apps/web/src/app/api/freya/initiative/route.ts
// Мини-Фрея: принимает цель, создает инициативу, вызывает Ребекку и возвращает объединенный ответ.

export const runtime = "nodejs";

type KPI = { name: string; target: number; unit?: string };

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const kpi: KPI[] = Array.isArray(body.kpi) ? body.kpi : [];
    const budget = body.budget ?? null; // { tokens?: number, usd?: number }
    const deadline = typeof body.deadline === "string" ? body.deadline : null;

    if (!goal) {
      return new Response(JSON.stringify({ error: "Provide 'goal' as non-empty string" }), { status: 400 });
    }

    // Инициатива Фреи (без БД, пока в ответе)
    const initiative = {
      initiative_id: crypto.randomUUID(),
      goal,
      kpi,
      budget,
      deadline,
      status: "created",
      created_at: new Date().toISOString()
    };

    // Вычисляем базовый URL из запроса, чтобы обратиться к Ребекке на том же хосте
    const base = new URL(req.url);
    base.pathname = "/api/rebecca/execute";
    base.search = "";

    // Вызываем Ребекку
    const rebeccaResp = await fetch(base.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal })
    });

    if (!rebeccaResp.ok) {
      const errText = await rebeccaResp.text();
      return new Response(
        JSON.stringify({ error: "Rebecca failed", initiative, details: errText }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const rebeccaJson = await rebeccaResp.json().catch(() => ({}));
    const plan = typeof rebeccaJson.plan === "string" ? rebeccaJson.plan : "Нет плана от Ребекки.";

    // Объединенный ответ Фреи
    const result = {
      initiative,
      rebecca: { plan }
    };

    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 500 });
  }
}
