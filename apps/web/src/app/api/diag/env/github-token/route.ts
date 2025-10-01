import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tok = (process.env.GITHUB_TOKEN || "").trim();
  const masked = tok ? `${tok.slice(0, 7)}… (len=${tok.length})` : "";
  return NextResponse.json({ ok: !!tok, tokenMasked: masked });
}
