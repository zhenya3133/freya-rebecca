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
  content_preview?: string | null;
};

export default function Playground() {
  // === Инициатива ===
  const [goal, setGoal] = useState("Сделай план запуска ИИ-агентов для мастера маникюра в Минске");
  const [deadline, setDeadline] = useState("2025-09-15");
  const [tokens, setTokens] = useState(500000);
  const [usd, setUsd] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(() => goal.trim().length > 0 && !loading, [goal, loading]);

  async function refreshRecent() {
    try {
      const r = await fetch("/api/initiatives/recent", { cache: "no-store" });
      const j = await r.json();
      setRecent(j.items ?? []);
    } catch (e: any) {
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

  // === Поиск по памяти ===
  const [memQuery, setMemQuery] = useState("как запустить пилоты, интеграции и маркетинг в Минске");
  const [memLimit, setMemLimit] = useState(5);
  const [memLoading, setMemLoading] = useState(false);
  const [memErr, setMemErr] = useState<string | null>(null);
  const [memHits, setMemHits] = useState<MemoryHit[]>([]);

  async function searchMemory() {
    setMemLoading(true);
    setMemErr(null);
    setMemHits([]);
    try {
      const r = await fetch("/api/memory/search", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ query: memQuery, limit: memLimit }),
      });
      const j = await r.json();
      if (!r.ok) {
        setMemErr(j?.error ?? "unknown");
      } else {
        setMemHits(j.items ?? []);
      }
    } catch (e: any) {
      setMemErr(String(e?.message ?? e));
    } finally {
      setMemLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Freya → Rebecca Playground</h1>

      {/* === Запуск инициативы === */}
      <section style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
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
            <input value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ width: 160 }}>
            Tokens
            <input type="number" value={tokens} onChange={(e) => setTokens(Number(e.target.value))} style={{ width: "100%" }} />
          </label>
          <label style={{ width: 160 }}>
            USD
            <input type="number" value={usd} onChange={(e) => setUsd(Number(e.target.value))} style={{ width: "100%" }} />
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
            <div>initiative_id: <code>{result.initiative?.id}</code></div>
            <div>artifact_id: <code>{result.rebecca?.artifact_id ?? "—"}</code></div>
            <div>model: <code>{result.rebecca?.model ?? "n/a"}</code></div>
            <div>tokens: <code>{result.rebecca?.tokens ?? "n/a"}</div>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 12, borderRadius: 6, marginTop: 8 }}>
              {result.rebecca?.plan ?? "нет плана"}
            </pre>
          </div>
        )}
      </section>

      {/* === Поиск по памяти === */}
      <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <h3>Поиск по памяти</h3>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            value={memQuery}
            onChange={(e) => setMemQuery(e.target.value)}
            placeholder="Введите запрос близкий к тексту плана"
            style={{ flex: 1 }}
          />
          <input
            type="number"
            value={memLimit}
            min={1}
            max={20}
            onChange={(e) => setMemLimit(Number(e.target.value))}
            style={{ width: 90 }}
            title="Limit"
          />
          <button onClick={searchMemory} disabled={memLoading}>
            {memLoading ? "Ищем..." : "Искать"}
          </button>
        </div>

        {memErr && <div style={{ marginTop: 12, color: "#b00020" }}><b>{memErr}</b></div>}

        {memHits.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>id</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>kind</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>distance</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>created_at</th>
                </tr>
              </thead>
              <tbody>
                {memHits.map((h) => (
                  <tr key={h.id}>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f1f1" }}><code>{h.id}</code></td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f1f1" }}>{h.kind}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f1f1" }}>{h.distance.toFixed(6)}</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #f1f1f1" }}>{new Date(h.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
              Напоминание: чем меньше distance, тем ближе по смыслу.
            </div>
          </div>
        )}
      </section>

      {/* === Последние инициативы === */}
      <section style={{ marginTop: 24 }}>
        <h3>Последние инициативы</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {recent.map((it) => (
            <div key={it.initiative_id} style={{ border: "1px solid #eee", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: "#666" }}>
                {new Date(it.created_at).toLocaleString()} · {it.initiative_id}
              </div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{it.goal}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                artifact_id: <code>{it.artifact_id ?? "—"}</code> · tokens: <code>{it.cost_tokens ?? "n/a"}</code>
              </div>
              {it.content_preview && (
                <pre style={{ whiteSpace: "pre-wrap", background: "#fafafa", padding: 8, borderRadius: 6, marginTop: 6 }}>
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
