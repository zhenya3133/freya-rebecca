import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import OpenAI from "openai";
import crypto from "crypto";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-3-small";

function toVecLiteral(v: number[], frac = 6) {
  return "[" + v.map(x => Number(x).toFixed(frac)).join(",") + "]";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ns   = String(body?.ns ?? "").trim();
    const slot = (body?.slot === "prod" ? "prod" : "staging") as "staging" | "prod";
    const kind = String(body?.kind ?? "").trim();
    const content  = String(body?.content ?? "");
    const metadata = (body?.metadata && typeof body.metadata === "object") ? body.metadata : {};

    if (!ns || !kind || !content) {
      return NextResponse.json({ ok: false, error: "expected { ns, kind, content, metadata? }" }, { status: 400 });
    }

    const corpusId = `mem:${ns}:${kind}`;

    await q(
      `insert into corpus_registry
         (id, ns, owner, license, update_cadence, source_list, half_life_days, ttl_days, created_at, updated_at)
       values ($1, $2, $3, 'internal', 'manual', $4::jsonb, 365, 3650, now(), now())
       on conflict (id) do nothing`,
      [corpusId, ns, "memory", JSON.stringify([{ kind }])]
    );

    const embRes = await openai.embeddings.create({ model: EMBED_MODEL, input: [content] });
    const emb = embRes.data[0].embedding as unknown as number[];
    const vec = toVecLiteral(emb, 6);

    const source = {
      title: (metadata as any)?.name ?? kind,
      kind,
      metadata,
      provenance: "agents/save",
    };

    const contentHash = crypto.createHash("sha256")
      .update(`${ns}||${kind}||${content}`)
      .digest("hex");

    const id = crypto.randomUUID();

    await q(
      `insert into chunks
         (id, corpus_id, ns, slot, content, embedding, source, content_hash, created_at)
       values
         ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8, now())
       on conflict (content_hash, ns, slot) do nothing`,
      [id, corpusId, ns, slot, content, vec, JSON.stringify(source), contentHash]
    );

    return NextResponse.json({ ok: true, ns, slot, kind, id, corpusId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "memory upsert failed" }, { status: 500 });
  }
}
