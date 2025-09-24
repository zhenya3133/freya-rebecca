import { NextResponse } from "next/server";
import {
  RetrieveRequest,
  RetrieveResponse,
  Slot,
  NsMode,
  DomainFilter,
  clamp,
} from "@/lib/retrieval-contract";
import { retrieveV2 } from "@/lib/retriever_v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<RetrieveRequest>;

    // минимальная валидация
    const q = String(body.q ?? "").trim();
    const ns = String(body.ns ?? "").trim();
    const slot = (body.slot ?? "staging") as Slot;

    if (!q) {
      return NextResponse.json(
        [{ code: "invalid_type", expected: "string", received: "undefined", path: ["q"], message: "Required" }],
        { status: 400 }
      );
    }
    if (!ns) {
      return NextResponse.json(
        [{ code: "invalid_type", expected: "string", received: "undefined", path: ["ns"], message: "Required" }],
        { status: 400 }
      );
    }
    if (slot !== "staging" && slot !== "prod") {
      return NextResponse.json(
        [{ code: "invalid_enum", path: ["slot"], message: "slot must be 'staging'|'prod'" }],
        { status: 400 }
      );
    }

    const req2: RetrieveRequest = {
      q,
      ns,
      slot,
      topK: clamp(body.topK, 1, 50),
      candidateK: clamp(body.candidateK, 50, 1000),
      minSimilarity: clamp(body.minSimilarity, 0, 1),
      nsMode: (body.nsMode ?? "prefix") as NsMode,
      domainFilter: (body.domainFilter ?? undefined) as DomainFilter | undefined,
    };

    const out: RetrieveResponse = await retrieveV2(req2);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
