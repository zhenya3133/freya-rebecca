import { NextRequest, NextResponse } from "next/server";
import { deleteProfile } from "@/lib/profiles";

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

  const name = body?.name || body?.file;
  if (!name) return NextResponse.json({ error: "name or file is required" }, { status: 400 });

  const res = await deleteProfile(name);
  if (!res.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, deleted: res.file }, { status: 200 });
}
