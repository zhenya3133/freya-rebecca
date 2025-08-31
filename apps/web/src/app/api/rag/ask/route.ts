// apps/web/src/app/api/rag/ask/route.ts
import { NextRequest, NextResponse } from "next/server";
import { retrieveV2 } from "@/lib/retriever_v2"; // или: "@/lib/retriever_v2"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Вход (JSON):
 * {
 *   "query": "строка (обязательно)",
 *   "ns": "namespace (обязательно)",
 *   "fetchK": 24,
 *   "topK": 8,
 *   "minScore": 0.52,
 *   "lambda": 0.7,
 *   "slot": "staging" | "prod"
 * }
 * Выход (как раньше): { ok, matches:[{id, ns, score, snippet}] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query: string = body?.query;
    const ns: string = body?.ns;
    const fetchK: number = Number(body?.fetchK ?? 24);
    const topK: number = Number(body?.topK ?? 8);
    const minScore: number = Number(body?.minScore ?? 0.52);
    const lambda: number = Number(body?.lambda ?? 0.7);
    const slot: "staging" | "prod" = (body?.slot === "prod" ? "prod" : "staging");

    if (!query || !ns) {
      return NextResponse.json({ ok: false, error: "query and ns are required" }, { status: 400 });
    }

    const chunks = await retrieveV2({ ns, query, fetchK, topK, minScore, slot, lambda });

    return NextResponse.json({
      ok: true,
      matches: chunks.map(c => ({
        id: c.id,
        ns,
        score: Number(c.final.toFixed(4)),
        snippet: c.content.slice(0, 500),
      })),
    }, { status: 200 });
  } catch (e: any) {
    console.error("POST /api/rag/ask error:", e?.message ?? e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
