// apps/web/src/app/playground/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type RecentItem = {
  initiative_id: string;
  goal: string;
  kpi_json: any;
  budget_json: any;
  deadline: string | null;
  status: string;
  created_at: string;
  artifact_id: string | null;
  type: string | null;
  title: string | null;
  content_preview: string | null;
  cost_tokens: number | null;
  artifact_created_at: string | null;
};

type MemoryHit = {
  id: string;
  kind: string;
  distance: number;
  created_at: string;
  content?: string;
};

export default function Playground() {
  // ------- Инициатива -------
  const [goal, setGoal] = useState(
    "Сделай план запуска ИИ-агентов для мастера маникюра в Минске"
  );
  const [deadline, setDeadline] = useState("2025-09-15");
  const [tokens, setTokens] = useState(500000);
  const [usd, setUsd] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  // ------- Последние инициативы -------
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // ------- Поиск по памяти -------
  const [q, setQ] = useState(
    "пилоты, интеграции и маркетинг для салона красоты в Минске"
  );
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [hits, setHits] = useState<MemoryHit[]>([]);

  const canSubmit = useMemo(
    () => goal.trim().length > 0 && !loading,
    [goal, loading]
  );

  async function refreshRecent() {
    try {
      const r = await fetch("/api/initiatives/recent", { cache: "no-store" });
      const j = await r.json();
      setRecent(j.items ?? []);
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refreshRecent();
  }, []);

  async function run() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const body = {
        goal,
        kpi: [{ name: "Leads", target: 5, unit: "count" }],
        budget: { tokens, usd },
        deadline,
      };
      const r = await fetch("/api/freya/initiative", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(`Ошибка: ${j?.step ?? "unknown"} -> ${j?.error ?? "no message"}`);
      } else {
        setResult(j);
        refreshRecent();
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function searchMemory() {
    setSearching(true);
    setSearchErr(null);
    setHits([]);
    try {
      const body = { query: q, limit: 5 };
      const r = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setSearchErr(String(j?.error ?? "search failed"));
      } else {
        setHits(j.items ?? []);
      }
    } catch (e: any) {
      setSearchErr(String(e?.message ?? e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Freya → Rebecca Playground</h1>

      {/* ---------- Запуск инициативы ---------- */}
      <section
        style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}
      >
        <h3>Запуск инициативы</h3>
        <label>
          Цель:
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: 8 }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <label style={{ flex: 1 }}>
            Дедлайн (YYYY-MM-DD)
            <input
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ width: 160 }}>
            Tokens
            <input
              type="number"
              value={tokens}
              onChange={(e) => setTokens(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ width: 160 }}>
            USD
            <input
              type="number"
              value={usd}
              onChange={(e) => setUsd(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        <button onClick={run} disabled={!canSubmit} style={{ marginTop: 14 }}>
          {loading ? "Запускаем..." : "Запустить Freya → Rebecca"}
        </button>

        {err && (
          <div style={{ marginTop: 12, color: "#b00020" }}>
            <b>{err}</b>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 16 }}>
            <h4>Результат</h4>
            <div>
              initiative_id: <code>{result.initiative?.id}</code>
            </div>
            <div>
              artifact_id: <code>{result.rebecca?.artifact_id ?? "—"}</code>
            </div>
            <div>
              model: <code>{result.rebecca?.model ?? "n/a"}</code>
            </div>
            <div>
              tokens: <code>{result.rebecca?.tokens ?? "n/a"}</code>
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#f7f7f7",
                padding: 12,
                borderRadius: 6,
                marginTop: 8,
              }}
            >
              {result.rebecca?.plan ?? "нет плана"}
            </pre>

            {/* Если rebecca/execute возвращает context_used, покажем для дебага */}
            {Array.isArray(result.rebecca?.context_used) && (
              <>
                <h5 style={{ marginTop: 12 }}>Контекст RAG (идентификаторы памяти):</h5>
                <ul>
                  {result.rebecca.context_used.map((c: any) => (
                    <li key={c.id}>
                      <code>{c.id}</code> · distance:{" "}
                      <code>{Number(c.distance).toFixed(3)}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>

      {/* ---------- Поиск по памяти ---------- */}
      <section
        style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}
      >
        <h3>Поиск по памяти</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Введите запрос…"
            style={{ flex: 1 }}
          />
          <button onClick={searchMemory} disabled={searching}>
            {searching ? "Ищем…" : "Найти"}
          </button>
        </div>

        {searchErr && (
          <div style={{ marginTop: 8, color: "#b00020" }}>
            <b>{searchErr}</b>
          </div>
        )}

        {hits.length > 0 && (
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {hits.map((h) => (
              <div
                key={h.id}
                style={{ border: "1px solid #eee", padding: 8, borderRadius: 6 }}
              >
                <div style={{ fontSize: 12, color: "#666" }}>
                  {new Date(h.created_at).toLocaleString()} · {h.id}
                </div>
                <div>
                  kind: <code>{h.kind}</code> · distance:{" "}
                  <code>{Number(h.distance).toFixed(3)}</code>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- Последние инициативы ---------- */}
      <section style={{ marginTop: 24 }}>
        <h3>Последние инициативы</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {recent.map((it) => (
            <div
              key={it.initiative_id}
              style={{ border: "1px solid #eee", padding: 12, borderRadius: 6 }}
            >
              <div style={{ fontSize: 12, color: "#666" }}>
                {new Date(it.created_at).toLocaleString()} · {it.initiative_id}
              </div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{it.goal}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                artifact_id: <code>{it.artifact_id ?? "—"}</code> · tokens:{" "}
                <code>{it.cost_tokens ?? "n/a"}</code>
              </div>
              {it.content_preview && (
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    background: "#fafafa",
                    padding: 8,
                    borderRadius: 6,
                    marginTop: 6,
                  }}
                >
                  {it.content_preview}
                </pre>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
