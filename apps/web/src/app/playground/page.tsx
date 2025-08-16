// apps/web/src/app/playground/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type KPI = { name: string; target: number; unit?: string };

type RecentItem = {
  initiative_id: string;
  goal: string;
  kpi_json: unknown;
  budget_json: unknown;
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

type RecentResponse = { items: RecentItem[] };

type InitiativeRow = {
  id: string;
  goal: string;
  kpi_json: unknown;
  budget_json: unknown;
  deadline: string | null;
  status: string;
  created_at: string;
};

type RebeccaPart = {
  model: string | null;
  tokens: number | null;
  artifact_id: string | null;
  plan: string | null;
};

type FreyaInitiativeResponse = {
  initiative?: InitiativeRow;
  rebecca?: RebeccaPart;
  step?: string;
  error?: string;
};

function getErrMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function Playground() {
  const [goal, setGoal] = useState(
    "Сделай план запуска ИИ-агентов для мастера маникюра в Минске",
  );
  const [deadline, setDeadline] = useState("2025-09-15");
  const [tokens, setTokens] = useState<number>(500000);
  const [usd, setUsd] = useState<number>(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FreyaInitiativeResponse | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => goal.trim().length > 0 && !loading,
    [goal, loading],
  );

  async function refreshRecent(): Promise<void> {
    try {
      const r = await fetch("/api/initiatives/recent", { cache: "no-store" });
      const j = (await r.json()) as RecentResponse;
      setRecent(Array.isArray(j.items) ? j.items : []);
    } catch (e: unknown) {
      console.error(getErrMessage(e));
    }
  }

  useEffect(() => {
    void refreshRecent();
  }, []);

  async function run(): Promise<void> {
    setLoading(true);
    setErr(null);
    setResult(null);

    try {
      const body: {
        goal: string;
        kpi: KPI[];
        budget: { tokens: number; usd: number };
        deadline: string;
      } = {
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

      const j = (await r.json()) as FreyaInitiativeResponse;

      if (!r.ok) {
        setErr(`Ошибка: ${j?.step ?? "unknown"} -> ${j?.error ?? "no message"}`);
      } else {
        setResult(j);
        void refreshRecent();
      }
    } catch (e: unknown) {
      setErr(getErrMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Freya → Rebecca Playground</h1>

      <section
        style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
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
              onChange={(e) => {
                const v = Number(e.target.value);
                setTokens(Number.isFinite(v) ? v : 0);
              }}
              style={{ width: "100%" }}
            />
          </label>

          <label style={{ width: 160 }}>
            USD
            <input
              type="number"
              value={usd}
              onChange={(e) => {
                const v = Number(e.target.value);
                setUsd(Number.isFinite(v) ? v : 0);
              }}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        <button onClick={() => void run()} disabled={!canSubmit} style={{ marginTop: 14 }}>
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
          </div>
        )}
      </section>

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
