import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const raw = process.env.GITHUB_TOKEN || "";
  // ничего секретного: показываем только длину и префикс
  return NextResponse.json({
    ok: true,
    tokenLen: raw.length,
    prefix: raw.slice(0, 10),  // например "github_pat"
  });
}
