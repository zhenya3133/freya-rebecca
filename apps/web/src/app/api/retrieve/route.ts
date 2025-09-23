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

  // ➜ добавили доменный фильтр в контракт
  domainFilter?: {
    allow?: string[];
    deny?: string[];
  } | null;
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

    // Жёсткое приведение типов чисел (часто прилетает как string/null/undefined)
    const topK =
      typeof body.topK === "number" && Number.isFinite(body.topK)
        ? Math.max(1, Math.floor(body.topK))
        : 5;

    const candidateK =
      typeof body.candidateK === "number" && Number.isFinite(body.candidateK)
        ? Math.max(topK, Math.floor(body.candidateK))
        : 200;

    const minSimilarity =
      typeof body.minSimilarity === "number" && Number.isFinite(body.minSimilarity)
        ? body.minSimilarity
        : undefined;

    // Корректно пробрасываем domainFilter (если массивы пустые — тоже пробрасываем)
    const domainFilter =
      body.domainFilter && typeof body.domainFilter === "object"
        ? {
            allow: Array.isArray(body.domainFilter.allow) ? body.domainFilter.allow : undefined,
            deny: Array.isArray(body.domainFilter.deny) ? body.domainFilter.deny : undefined,
          }
        : null;

    // Recency по умолчанию
    const recency: RecencyOptions =
      body.recency && typeof body.recency === "object"
        ? {
            enabled: body.recency.enabled ?? true,
            halfLifeDays: body.recency.halfLifeDays ?? 30,
            weight: body.recency.weight ?? 0.2,
            usePublishedAt: body.recency.usePublishedAt ?? false,
          }
        : { enabled: true, halfLifeDays: 30, weight: 0.2, usePublishedAt: false };

    stage = "retrieve";
    const result = await retrieveV2({
      ns: body.ns,
      slot: body.slot ?? "staging",
      query: body.query,
      topK,                    // ✅ теперь точно topK
      candidateK,              // ✅ и candidateK
      nsMode: body.nsMode ?? "strict",
      includeKinds: body.includeKinds ?? null,
      includeSourceTypes: body.includeSourceTypes ?? null,
      minSimilarity,           // может быть undefined
      recency,
      domainFilter,            // ✅ пробрасываем фильтр доменов
    });

    // Небольшой маячок, помогает в отладке энд-ту-энд
    return NextResponse.json(
      { ok: true, ...result, took_ms_route: Date.now() - t0, routeVersion: "retrieve-route-v2.1" },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, stage, error: e?.message || String(e) },
      { status: 500 },
    );
  }
}
