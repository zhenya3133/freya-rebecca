import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const x = process.env.X_ADMIN_KEY || "";
  const d = process.env.DATABASE_URL || "";
  return NextResponse.json({
    X_ADMIN_KEY: { len: x.length },
    DATABASE_URL: { len: d.length, startsWith: d.slice(0, 16) }
  });
}
