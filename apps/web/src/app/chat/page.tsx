"use client";

import React, { useCallback, useMemo, useState } from "react";

type Source = { n?: number; path?: string; score?: number };
type Match = { id?: string; path?: string; ns?: string; score?: number; preview?: string; snippet?: string };
type RagResponse = {
  ok?: boolean;
  model?: string;
  profile?: string;
  mode?: string;
  answer?: string;
  error?: string;
  sources?: Source[];
  matches?: Match[];
  logId?: string;
};

const CLIENT_TIMEOUT_MS = 12000; // 12s — клиентский таймаут, после него пробуем фолбэк

async function fetchJsonWithTimeout(url: string, payload: any, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(t);
  }
}

export default function ChatPage() {
  const [ns, setNs] = useState("rebecca/docs");
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(8);
  const [minScore, setMinScore] = useState(0.35);
  const [maxTokens, setMaxTokens] = useState(700);
  const [logging, setLogging] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<RagResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usedUrl, setUsedUrl] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const canSend = useMemo(
    () => query.trim().length > 0 && ns.trim().length > 0 && !busy,
    [query, ns, busy]
  );

  const onSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;

    const payload = { query, ns, topK, minScore, maxTokens };

    setBusy(true);
    setError(null);
    setResp(null);
    setUsedUrl(null);
    setElapsedMs(null);

    const started = Date.now();

    // 1) пробуем логируемый guarded, если включен тумблер
    if (logging) {
      const r1 = await fetchJsonWithTimeout("/api/rag/answer-logged-guarded", payload, CLIENT_TIMEOUT_MS)
        .catch((e: any) => ({ ok: false, status: 0, data: { error: String(e?.name === "AbortError" ? `Timeout ${CLIENT_TIMEOUT_MS}ms` : e?.message || e) } }));

      if (r1.ok) {
        setResp(r1.data);
        setUsedUrl("/api/rag/answer-logged-guarded");
        setElapsedMs(Date.now() - started);
        setBusy(false);
        return;
      }

      // фолбэк условия: 403 (логи выключены), 504/502/408, 0 (сетевая/Abort), любое r1.ok=false
      const shouldFallback = [0, 403, 408, 502, 504].includes(r1.status);
      if (!shouldFallback) {
        // если это другая ошибка (например, 400 валидация) — покажем её и выйдем
        setError(r1.data?.error || `HTTP ${r1.status}`);
        setUsedUrl("/api/rag/answer-logged-guarded");
        setElapsedMs(Date.now() - started);
        setBusy(false);
        return;
      }
    }

    // 2) фолбэк на обычный guarded
    const r2 = await fetchJsonWithTimeout("/api/rag/answer-guarded", payload, CLIENT_TIMEOUT_MS)
      .catch((e: any) => ({ ok: false, status: 0, data: { error: String(e?.name === "AbortError" ? `Timeout ${CLIENT_TIMEOUT_MS}ms` : e?.message || e) } }));

    setUsedUrl("/api/rag/answer-guarded");
    setElapsedMs(Date.now() - started);

    if (r2.ok) setResp(r2.data);
    else setError(r2.data?.error || `HTTP ${r2.status}`);

    setBusy(false);
  }, [canSend, logging, query, ns, topK, minScore, maxTokens]);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Chat · RAG (guarded)</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="block text-sm font-medium mb-1">Namespace (ns)</label>
            <input className="w-full border rounded-xl px-3 py-2" value={ns} onChange={(e) => setNs(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">topK</label>
            <input type="number" min={1} max={20} className="w-full border rounded-xl px-3 py-2"
                   value={topK} onChange={(e) => setTopK(parseInt(e.target.value || "8", 10))}/>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">minScore</label>
            <input type="number" step="0.01" min={0} max={1}
                   className="w-full border rounded-xl px-3 py-2"
                   value={minScore} onChange={(e) => setMinScore(parseFloat(e.target.value || "0.35"))}/>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">maxTokens</label>
            <input type="number" min={1} max={8192} className="w-full border rounded-xl px-3 py-2"
                   value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value || "700", 10))}/>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center space-x-2">
              <input type="checkbox" checked={logging} onChange={(e) => setLogging(e.target.checked)} />
              <span>Логировать запрос (answer-logged-guarded)</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Запрос</label>
          <textarea
            className="w-full border rounded-xl px-3 py-2 min-h-[120px]"
            placeholder="Задайте вопрос к выбранному ns…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={!canSend} className="rounded-2xl px-4 py-2 border shadow disabled:opacity-50">
            {busy ? "Отправка…" : "Отправить"}
          </button>
          {usedUrl && (
            <span className="text-sm opacity-70">
              {elapsedMs != null ? `${elapsedMs}ms · ` : ""}{usedUrl}
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="mt-4 p-3 border border-red-300 rounded-xl bg-red-50 text-red-800">
          Ошибка: {error}
        </div>
      )}

      {resp && (
        <div className="mt-6 space-y-4">
          <div className="p-4 border rounded-2xl bg-white">
            <div className="text-sm text-gray-600 mb-1">
              {resp.model ? `model: ${resp.model}` : null}
              {resp.profile ? ` · profile: ${resp.profile}` : null}
              {resp.mode ? ` · mode: ${resp.mode}` : null}
              {resp.logId ? ` · logId: ${resp.logId}` : null}
            </div>
            <div className="whitespace-pre-wrap text-base">{resp.answer || resp.error || "—"}</div>
          </div>

          {resp.sources && resp.sources.length > 0 && (
            <div className="p-4 border rounded-2xl bg-white">
              <h2 className="font-medium mb-2">Sources</h2>
              <ul className="list-disc ml-5 space-y-1">
                {resp.sources.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-mono">#{s.n ?? i + 1}</span> · {s.path ?? "—"}
                    {typeof s.score === "number" ? <span className="opacity-70"> (score: {s.score.toFixed(3)})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resp.matches && resp.matches.length > 0 && (
            <div className="p-4 border rounded-2xl bg-white">
              <h2 className="font-medium mb-2">Matches</h2>
              <ul className="space-y-3">
                {resp.matches.map((m, i) => (
                  <li key={m.id ?? i} className="text-sm border rounded-xl p-2">
                    <div className="text-gray-700">
                      <span className="font-mono">{m.id?.slice(0, 8) ?? i + 1}</span>
                      {m.path ? <> · <span className="font-semibold">{m.path}</span></> : null}
                      {typeof m.score === "number" ? <span className="opacity-70"> (score: {m.score.toFixed(3)})</span> : null}
                    </div>
                    <div className="opacity-80 whitespace-pre-wrap">{m.preview ?? m.snippet ?? ""}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
