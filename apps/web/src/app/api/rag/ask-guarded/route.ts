/**
 * src/app/api/rag/ask-guarded/route.ts
 * POST /api/rag/ask-guarded
 * Тело: { query | prompt, ns, topK?, minScore?, maxTokens?, ... }
 */
import { NextRequest, NextResponse } from "next/server";
import { validateRagParams, limitText, assertNamespace } from "@/lib/guardrails";
import { rateLimitCheck } from "@/lib/rate_limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(new Error(`Timeout ${ms}ms`)), ms).unref?.();
  return c.signal;
}

export async function POST(req: NextRequest) {
  // 1) rate-limit
  const rl = rateLimitCheck(req);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  // 2) parse & guard
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const inputQuery: string | undefined = body?.query ?? body?.prompt;
  try {
    limitText(inputQuery);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }

  let ns: string;
  try {
    ns = assertNamespace(body?.ns);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }

  const qp = req.nextUrl.searchParams;
  const guard = validateRagParams({
    topK: body?.topK ?? qp.get("topK"),
    minScore: body?.minScore ?? qp.get("minScore"),
    maxTokens: body?.maxTokens ?? qp.get("maxTokens"),
  });

  // 3) proxy → /api/rag/ask (ожидает поле 'query')
  const upstreamUrl = new URL("/api/rag/ask", req.url);
  const timeoutMs = Number(process.env.RAG_TIMEOUT_MS ?? 30000);

  const upstream = await fetch(upstreamUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...body,
      query: inputQuery,
      ns,
      topK: guard.topK,
      minScore: guard.minScore,
      maxTokens: guard.maxTokens,
    }),
    signal: timeoutSignal(timeoutMs),
  }).catch((e) => new Response(JSON.stringify({ error: String(e?.message ?? e) }), { status: 504 }));

  const data = await (upstream as Response).json().catch(() => ({}));
  return NextResponse.json(data, { status: (upstream as Response).status });
}
