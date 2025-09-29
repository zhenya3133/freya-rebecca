// apps/web/src/app/api/retrieve/route.ts
import { NextResponse } from "next/server";
import { retrieveV2 } from "@/lib/retriever_v2";
import type {
  RetrieveRequest,
  RetrieveResponse,
  NsMode,
} from "@/lib/retrieval-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  q: string;
  ns: string;
  slot?: "staging" | "prod" | string | null;
  topK?: number;
  candidateK?: number;
  minSimilarity?: number;
  nsMode?: NsMode;
  domainFilter?: { allow?: string[]; deny?: string[] } | null;
};

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;

    // обязательные поля
    if (!b?.q || !b?.ns) {
      return NextResponse.json(
        { error: "q and ns are required" },
        { status: 400 }
      );
    }

    // нормализация
    const slot = (b.slot === "prod" ? "prod" : "staging") as "staging" | "prod";
    const topK = Math.max(1, Math.min(Number(b.topK ?? 5), 50));
    const candidateK = Math.max(topK, Math.min(Number(b.candidateK ?? 200), 1000));
    const minSimilarity = Math.max(0, Math.min(Number(b.minSimilarity ?? 0), 1));
    const nsMode: NsMode = b.nsMode === "strict" ? "strict" : "prefix";

    const body: RetrieveRequest = {
      q: String(b.q),
      ns: String(b.ns),
      slot,
      topK,
      candidateK,
      minSimilarity,
      nsMode,
      domainFilter: b.domainFilter ?? null,
    };

    const out: RetrieveResponse = await retrieveV2(body);
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
