// apps/web/src/app/api/agents/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { AgentSpecArraySchema } from "@/lib/schemas/agent";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const agents = AgentSpecArraySchema.parse(payload);

    const url  = new URL(req.url);
    const ns   = url.searchParams.get("ns") || "rebecca/army/agents";
    const slot = (url.searchParams.get("slot") as "staging" | "prod") || "staging";

    url.pathname = "/api/memory/upsert";

    let saved = 0;
    for (const ag of agents) {
      const body = {
        ns,
        slot,
        kind: "rebecca/army/agents",
        content: JSON.stringify(ag, null, 2),
        metadata: { type: "agent", schema_version: "v1", status: "draft", name: ag.name, provenance: "facts+LLM" }
      };

      const r = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(await r.text());
      saved++;
    }
    return NextResponse.json({ ok: true, saved, ns, slot });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}
