// apps/web/src/app/api/freya/initiative/route.ts
import { pool } from "@/lib/db";
export const runtime = "nodejs";

type KPI = { name: string; target: number; unit?: string };

type InitiativeRow = {
  id: string;
  goal: string;
  kpi_json: unknown;
  budget_json: unknown;
  deadline: string | null;
  status: string;
  created_at: string;
};

type RebeccaUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type RebeccaResponse = {
  plan?: string;
  model?: string;
  usage?: RebeccaUsage;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function toNumberOrNull(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function readRebecca(obj: unknown): RebeccaResponse {
  if (!obj || typeof obj !== "object") return {};
  const o = obj as Record<string, unknown>;
  const usage = (o.usage && typeof o.usage === "object" ? o.usage : {}) as Record<
    string,
    unknown
  >;

  return {
    plan: typeof o.plan === "string" ? o.plan : undefined,
    model: typeof o.model === "string" ? o.model : undefined,
    usage: {
      input_tokens: toNumberOrNull(usage.input_tokens ?? usage["input"]),
      output_tokens: toNumberOrNull(usage.output_tokens ?? usage["output"]),
      total_tokens: toNumberOrNull(usage.total_tokens ?? usage["total"]),
    },
  };
}

export async function POST(req: Request) {
  try {
    const bodyRaw = await req.json().catch(() => ({} as unknown));
    const body = (bodyRaw && typeof bodyRaw === "object"
      ? (bodyRaw as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    const kpi: KPI[] = Array.isArray(body.kpi) ? (body.kpi as KPI[]) : [];
    const budget = body.budget ?? null;
    const deadline = typeof body.deadline === "string" ? body.deadline : null;

    if (!goal) {
      return json({ error: "Provide 'goal' as non-empty string" }, 400);
    }
    if (!process.env.DATABASE_URL) {
      return json({ error: "DATABASE_URL not set" }, 500);
    }

    // 1) INSERT initiative
    let initiative: InitiativeRow;
    try {
      const insertSql = `
        INSERT INTO initiatives (goal, kpi_json, budget_json, deadline, status)
        VALUES ($1, $2, $3, $4::date, 'created')
        RETURNING id, goal, kpi_json, budget_json, deadline, status, created_at
      `;
      const params = [goal, JSON.stringify(kpi), JSON.stringify(budget), deadline];
      const { rows } = await pool.query<InitiativeRow>(insertSql, params);
      initiative = rows[0];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ step: "insert_initiative", error: msg }, 500);
    }

    // 2) Call Rebecca
    let rebecca: RebeccaResponse = {};
    try {
      const origin =
        process.env.VERCEL_URL && process.env.VERCEL_URL.length > 0
          ? `https://${process.env.VERCEL_URL}`
          : new URL(req.url).origin;

      const rebeccaResp = await fetch(`${origin}/api/rebecca/execute`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ goal }),
        cache: "no-store",
      });

      if (!rebeccaResp.ok) {
        const errText = await rebeccaResp.text();
        return json({ step: "call_rebecca", initiative, error: errText }, 502);
      }

      const rebeccaJson = (await rebeccaResp.json().catch(() => ({}))) as unknown;
      rebecca = readRebecca(rebeccaJson);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ step: "call_rebecca_throw", initiative, error: msg }, 500);
    }

    // 3) INSERT artifact (plan)
    try {
      const plan =
        typeof rebecca.plan === "string" && rebecca.plan.trim().length > 0
          ? rebecca.plan
          : "Нет плана от Ребекки.";

      const model = rebecca.model ?? "gpt-4.1-mini";
      const usage = rebecca.usage ?? {};
      const tokens =
        toNumberOrNull(usage.total_tokens) ??
        (toNumberOrNull(usage.input_tokens) ?? 0) +
          (toNumberOrNull(usage.output_tokens) ?? 0) ||
        null;

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
      const art = await pool
        .query<{ id: string; created_at: string }>(insertArtifact, aParams)
        .then((r) => r.rows[0]);

      // 4) НЕ ломающийся upsert в память
      try {
        const origin =
          process.env.VERCEL_URL && process.env.VERCEL_URL.length > 0
            ? `https://${process.env.VERCEL_URL}`
            : new URL(req.url).origin;

        await fetch(`${origin}/api/memory/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            content: plan,
            kind: "plan",
            initiative_id: initiative.id,
            metadata: { source: "freya/initiative", goal, model },
          }),
          cache: "no-store",
        }).catch(() => undefined);
      } catch {
        // глушим — память не должна ломать создание инициативы
      }

      return json({
        initiative,
        rebecca: { model, tokens, artifact_id: art?.id ?? null, plan },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ step: "insert_artifact", initiative, error: msg }, 500);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ step: "outer_catch", error: msg }, 500);
  }
}
