// apps/web/src/app/api/evals/smoke/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type CaseResult = {
  name: string;
  ok: boolean;
  ms: number;
  notes?: string[];
  errors?: string[];
  meta?: any;
};

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { okHttp: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function GET(req: NextRequest) {
  try {
    const u = new URL(req.url);

    const ns = (u.searchParams.get("ns") || "rebecca/army/agents").trim();
    const slot = (u.searchParams.get("slot") === "prod" ? "prod" : "prod") as "staging" | "prod"; // по умолчанию prod
    const model = (u.searchParams.get("model") || "gpt-4o-mini").trim();
    const topK = Number(u.searchParams.get("topK") || "10");
    const minScore = Number(u.searchParams.get("minScore") || "0.1");
    const maxTokens = Number(u.searchParams.get("maxTokens") || "700");

    const base = new URL("/", req.url).toString().replace(/\/+$/, "");

    const cases: CaseResult[] = [];

    // --- CASE A: JSON профиль -> массив {name,purpose} ---
    {
      const started = nowMs();
      const errors: string[] = [];
      const notes: string[] = [];

      const body = {
        query: "Верни СТРОГО JSON-массив всех сохранённых агентов {name,purpose} без текста до/после.",
        ns, topK, minScore, maxTokens, model,
        profile: "json",
        debug: true
      };
      const r = await fetchJson(`${base}/api/rag/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!r.okHttp) errors.push(`HTTP ${r.status}`);
      const payload = r.json?.payload;
      const sources = r.json?.sources;

      if (!Array.isArray(payload)) {
        errors.push("payload не массив");
      } else {
        if (payload.length < 5) notes.push(`payload length = ${payload.length} (<5)`);
        // быстрая валидация
        const bad = payload.find((x: any) => !(x?.name && x?.purpose));
        if (bad) errors.push("в payload есть элементы без {name,purpose}");
      }

      if (!Array.isArray(sources) || sources.length === 0) {
        notes.push("источники пусты (sources)");
      }

      cases.push({
        name: "A.json_agents_name_purpose",
        ok: r.okHttp && Array.isArray(payload) && payload.length > 0 && !errors.length,
        ms: Math.round(nowMs() - started),
        notes, errors,
        meta: { gotItems: Array.isArray(payload) ? payload.length : 0, status: r.status }
      });
    }

    // --- CASE B: LIST профиль -> маркдаун-список ---
    {
      const started = nowMs();
      const errors: string[] = [];
      const notes: string[] = [];

      const body = {
        query: "Дай список сохранённых агентов: имя и краткая цель.",
        ns, topK, minScore, maxTokens, model,
        profile: "list",
        debug: false
      };
      const r = await fetchJson(`${base}/api/rag/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!r.okHttp) errors.push(`HTTP ${r.status}`);
      const answer = String(r.json?.answer ?? "");
      if (!answer.trim()) errors.push("answer пуст");

      // очень простая эвристика: не менее 5 пунктов вида "- **Name**: ..."
      const lines = answer.split(/\r?\n/).filter(l => l.trim().startsWith("- "));
      if (lines.length < 5) notes.push(`мало пунктов в списке: ${lines.length}`);

      cases.push({
        name: "B.list_agents_bullets",
        ok: r.okHttp && !!answer.trim() && !errors.length,
        ms: Math.round(nowMs() - started),
        notes, errors,
        meta: { bullets: lines.length, status: r.status }
      });
    }

    // --- CASE C: ASK (кандидаты) ---
    {
      const started = nowMs();
      const errors: string[] = [];
      const notes: string[] = [];

      const body = {
        query: "Назови 10 сохранённых агентов по этому namespace.",
        ns, topK, minScore
      };
      const r = await fetchJson(`${base}/api/rag/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!r.okHttp) errors.push(`HTTP ${r.status}`);
      const matches = r.json?.matches;
      if (!Array.isArray(matches) || matches.length === 0) {
        errors.push("matches пуст");
      } else {
        if (matches.length < 5) notes.push(`matches: ${matches.length} (<5)`);
      }

      cases.push({
        name: "C.ask_candidates",
        ok: r.okHttp && Array.isArray(matches) && matches.length > 0 && !errors.length,
        ms: Math.round(nowMs() - started),
        notes, errors,
        meta: { matches: Array.isArray(matches) ? matches.length : 0, status: r.status }
      });
    }

    const pass = cases.filter(c => c.ok).length;
    const fail = cases.length - pass;

    return NextResponse.json({
      ok: fail === 0,
      ns, slot, model,
      summary: { total: cases.length, pass, fail },
      cases
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "smoke failed" }, { status: 500 });
  }
}
