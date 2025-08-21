import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function sanitizeToken(raw: string) {
  // убираем всё не-ASCII и пробелы по краям
  return (raw || "").replace(/[^\x20-\x7E]/g, "").trim();
}

async function tryAuth(scheme: "bearer" | "token") {
  const tk = sanitizeToken(process.env.GITHUB_TOKEN || "");
  const h: Record<string, string> = {
    "user-agent": "FreyaRebecca/diag",
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  if (tk) h.authorization = scheme === "bearer" ? `Bearer ${tk}` : `token ${tk}`;
  const r = await fetch("https://api.github.com/rate_limit", { headers: h });
  const txt = await r.text();
  return { ok: r.ok, status: r.status, scheme, body: txt.slice(0, 400), tokenLen: tk.length, prefix: tk.slice(0,10), suffix: tk.slice(-6) };
}

export async function GET() {
  const b = await tryAuth("bearer");
  if (b.ok) return NextResponse.json(b);
  const t = await tryAuth("token");
  return NextResponse.json(t.ok ? t : b);
}
