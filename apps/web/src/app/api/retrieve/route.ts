// apps/web/src/app/api/retrieve/route.ts
import { NextResponse } from "next/server";
import { retrieveV2, type RecencyOptions } from "@/lib/retriever_v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  ns: string;
  slot?: string | null;
  query: string;

  topK?: number;
  candidateK?: number;

  nsMode?: "strict" | "prefix";
  includeKinds?: string[] | null;
  includeSourceTypes?: string[] | null;

  minSimilarity?: number;

  recency?: RecencyOptions | null;
};

export async function POST(req: Request) {
  const t0 = Date.now();
  let stage = "init";
  try {
    stage = "parse";
    const body = (await req.json()) as Body;

    if (!body?.ns) {
      return NextResponse.json({ ok: false, error: "ns required" }, { status: 400 });
    }
    if (!body?.query?.trim()) {
      return NextResponse.json({ ok: false, error: "query required" }, { status: 400 });
    }

    stage = "retrieve";
    const result = await retrieveV2({
      ns: body.ns,
      slot: body.slot ?? "staging",
      query: body.query,
      topK: body.topK ?? 5,
      candidateK: body.candidateK ?? 200,
      nsMode: body.nsMode ?? "strict",
      includeKinds: body.includeKinds ?? null,
      includeSourceTypes: body.includeSourceTypes ?? null,
      minSimilarity: typeof body.minSimilarity === "number" ? body.minSimilarity : undefined,
      recency: body.recency ?? { enabled: true, halfLifeDays: 30, weight: 0.2, usePublishedAt: false },
    });

    return NextResponse.json({ ok: true, ...result, took_ms_route: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage, error: e?.message || String(e) },
      { status: 500 },
    );
  }
}
