// apps/web/src/app/api/initiatives/recent/route.ts
import { pool } from "@/lib/db";
export const runtime = "nodejs";

export async function GET() {
  try {
    const sql = `
      SELECT i.id        AS initiative_id,
             i.goal,
             i.kpi_json,
             i.budget_json,
             i.deadline,
             i.status,
             i.created_at,
             a.id        AS artifact_id,
             a.type,
             a.title,
             LEFT(a.content, 5000) AS content_preview,
             a.cost_tokens,
             a.created_at AS artifact_created_at
      FROM public.initiatives i
      LEFT JOIN public.artifacts a ON a.initiative_id = i.id AND a.type = 'plan'
      ORDER BY i.created_at DESC
      LIMIT 10
    `;
    const { rows } = await pool.query(sql);
    return new Response(JSON.stringify({ items: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
