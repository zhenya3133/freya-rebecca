import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

export async function GET() {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const model  = process.env.EMBED_MODEL || "text-embedding-3-small";
    const res = await client.embeddings.create({ model, input: ["hello"] });
    const dim = (res.data?.[0]?.embedding as unknown as number[])?.length ?? 0;
    return NextResponse.json({ ok:true, model, dim });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:String(e?.message ?? e), name:e?.name }, { status:500 });
  }
}
