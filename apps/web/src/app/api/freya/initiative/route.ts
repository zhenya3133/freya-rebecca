// apps/web/src/app/api/freya/initiative/route.ts
import { pool } from "@/lib/db";
export const runtime = "nodejs";

type KPI = { name: string; target: number; unit?: string };

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const kpi: KPI[] = Array.isArray(body.kpi) ? body.kpi : [];
    const budget = body.budget ?? null;
    const deadline = typeof body.deadline === "string" ? body.deadline : null;

    if (!goal) {
      return new Response(JSON.stringify({ error: "Provide 'goal' as non-empty string" }), {
        status: 400, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    if (!process.env.DATABASE_URL) {
      return new Response(JSON.stringify({ error: "DATABASE_URL not set" }), {
        status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 1) Сохраняем инициативу
    let initiative: {
      id: string; goal: string; kpi_json: unknown; budget_json: unknown;
      deadline: string | null; status: string; created_at: string;
    };
    try {
      const insertSql = `
        INSERT INTO initiatives (goal, kpi_json, budget_json, deadline, status)
        VALUES ($1, $2, $3, $4::date, 'created')
        RETURNING id, goal, kpi_json, budget_json, deadline, status, created_at
      `;
      const params = [goal, JSON.stringify(kpi), JSON.stringify(budget), deadline];
      const { rows } = await pool.query(insertSql, params);
      initiative = rows[0];
    } catch (e: unknown) {
      return new Response(JSON.stringify({ step: "insert_initiative", error: String((e as Error)?.message ?? e) }), {
        status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 2) Вызываем Ребекку
    let rebeccaJson: { plan?: string | null; model?: string | null; usage?: unknown } = {};
    try {
      const base = new URL(req.url);
      base.pathname = "/api/rebecca/execute";
      base.search = "";
      const rebeccaResp = await fetch(base.toString(), {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ goal })
      });
      if (!rebeccaResp.ok) {
        const errText = await rebeccaResp.text();
        return new Response(JSON.stringify({ step: "call_rebecca", initiative, error: errText }), {
          status: 502, headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }
      rebeccaJson = await rebeccaResp.json().catch(() => ({}));
    } catch (e: unknown) {
      return new Response(JSON.stringify({ step: "call_rebecca_throw", initiative, error: String((e as Error)?.message ?? e) }), {
        status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    // 3) Сохраняем артефакт (план)
    try {
      const plan   = typeof rebeccaJson.plan === "string" ? rebeccaJson.plan : "Нет плана от Ребекки.";
      const model  = rebeccaJson.model ?? "gpt-4.1-mini";
      const usage  = rebeccaJson.usage ?? null;
      const tokens =
        usage && typeof usage === "object" && usage !== null
          ? // @ts-expect-error – допускаем разные формы usage
            (usage.total_tokens ?? ((usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)))
          : null;

      const insertArtifact = `
        INSERT INTO artifacts (initiative_id, type, title, content, summary, cost_tokens, cost_usd, meta_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, created_at
      `;
      const aParams = [
        initiative.id,
        "plan",
        `Plan for: ${goal}`,
        plan,
        null,
        tokens,
        null,
        JSON.stringify({ model, usage }),
      ];
      const art = await pool.query(insertArtifact, aParams).then(r => r.rows[0] as { id: string });

      // 4) АВТО-запись в память (не валим весь запрос при ошибке памяти)
      try {
        const base = new URL(req.url);
        base.pathname = "/api/memory/upsert";
        await fetch(base.toString(), {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            initiative_id: initiative.id,
            kind: "plan",
            content: plan,
            metadata: { source: "initiative", artifact_id: art?.id ?? null, model },
          }),
        });
      } catch {
        // глушим – логика инициативы не должна падать из-за памяти
      }

      return new Response(JSON.stringify({
        initiative,
        rebecca: { model, tokens: tokens ?? null, artifact_id: art?.id ?? null, plan }
      }), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });

    } catch (e: unknown) {
      return new Response(JSON.stringify({ step: "insert_artifact", initiative, error: String((e as Error)?.message ?? e) }), {
        status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

  } catch (e: unknown) {
    return new Response(JSON.stringify({ step: "outer_catch", error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
}
