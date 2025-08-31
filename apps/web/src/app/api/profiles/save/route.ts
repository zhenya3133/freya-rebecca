import { NextRequest, NextResponse } from "next/server";
import { saveProfile } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertAdmin(req: NextRequest) {
  const need = process.env.ADMIN_KEY;
  const got = req.headers.get("x-admin-key") ?? "";
  if (!need || got !== need) throw new Error("Forbidden");
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const saved = await saveProfile(body);
    return NextResponse.json({ ok: true, saved }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 400 });
  }
}
