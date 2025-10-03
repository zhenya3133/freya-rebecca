// apps/web/src/app/playground/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

/* =======================
 * Типы данных
 * ======================= */

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

type MemoryHit = {
  id: string;
  kind: string;
  distance: number;
  created_at: string;
  content?: string;
};

type InitiativeRow = {
  id: string;
};

type RebeccaResult = {
  model?: string;
  tokens?: number | null;
  artifact_id?: string | null;
  plan?: string;
  // Если бэкенд вернёт использованный контекст — покажем.
  context_used?: Array<{ id: string; distance: number }>;
};

type InitiativeResponse = {
  initiative?: InitiativeRow;
  rebecca?: RebeccaResult;
};

type MemorySearchResponse = {
  items?: MemoryHit[];
};

type RagAskResponse = {
  answer: string;
  sources: MemoryHit[];
};

/* =======================
 * Компонент
 * ======================= */

export default function Playground() {
  /* ------- Инициатива ------- */
  const [goal, setGoal] = useState(
    "Сделай план запуска ИИ-агентов для мастера маникюра в Минске",
  );
  const [deadline, setDeadline] = useState("2025-09-15");
  const [tokens, setTokens] = useState(500_000);
  const [usd, setUsd] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InitiativeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /* ------- Последние инициативы ------- */
  const [recent, setRecent] = useState<RecentItem[]>([]);

  /* ------- Поиск по памяти ------- */
  const [q, setQ] = useState(
    "пилоты, интеграции и маркетинг для салона красоты в Минске",
  );
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [hits, setHits] = useState<MemoryHit[]>([]);

  /* ------- RAG: спросить у памяти ------- */
  const [ragQuery, setRagQuery] = useState(
    "Как запустить пилоты и интеграции для салона красоты?",
  );
  const [ragTopK, setRagTopK] = useState(4);
  const [ragLoading, setRagLoading] = useState(false);
  const [ragErr, setRagErr] = useState<string | null>(null);
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragSources, setRagSources] = useState<MemoryHit[]>([]);

  const canSubmit = useMemo(
    () => goal.trim().length > 0 && !loading,
    [goal, loading],
  );

  async function refreshRecent() {
    try {
      const r = await fetch("/api/initiatives/recent", { cache: "no-store" });
      const j: { items?: RecentItem[] } = await r.json();
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
        kpi: [{ name: "Leads", target: 5, unit: "count" } satisfies KPI],
        budget: { tokens, usd },
        deadline,
      };
      const r = await fetch("/api/freya/initiative", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });
      const j: InitiativeResponse & { step?: string; error?: string } =
        await r.json();
      if (!r.ok) {
        setErr(`Ошибка: ${j?.step ?? "unknown"} -> ${j?.error ?? "no message"}`);
      } else {
        setResult(j);
        refreshRecent();
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
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
      const j: MemorySearchResponse & { error?: string } = await r.json();
      if (!r.ok) {
        setSearchErr(String(j?.error ?? "search failed"));
      } else {
        setHits(j.items ?? []);
      }
    } catch (e) {
      setSearchErr(String((e as Error).message ?? e));
    } finally {
      setSearching(false);
    }
  }

  async function askRag() {
    setRagLoading(true);
    setRagErr(null);
    setRagAnswer("");
    setRagSources([]);
    try {
      const r = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ query: ragQuery, topK: ragTopK }),
      });
      const j: RagAskResponse & { error?: string } = await r.json();
      if (!r.ok) {
        setRagErr(typeof j?.error === "string" ? j.error : "RAG error");
      } else {
        setRagAnswer(j.answer ?? "");
        setRagSources(j.sources ?? []);
      }
    } catch (e) {
      setRagErr(String((e as Error).message ?? e));
    } finally {
      setRagLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1>Freya → Rebecca Playground</h1>

      {/* ---------- Запуск инициативы ---------- */}
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
              artifact_id:{" "}
              <code>{result.rebecca?.artifact_id ?? "—"}</code>
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
            {Array.isArray(result.rebecca?.context_used) &&
              result.rebecca!.context_used!.length > 0 && (
                <>
                  <h5 style={{ marginTop: 12 }}>
                    Контекст RAG (идентификаторы памяти):
                  </h5>
                  <ul>
                    {result.rebecca!.context_used!.map((c) => (
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

      {/* ---------- Поиск по памяти (векторный) ---------- */}
      <section
        style={{
          marginTop: 24,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
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
                {h.content && (
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      background: "#fafafa",
                      padding: 8,
                      borderRadius: 6,
                      marginTop: 6,
                    }}
                  >
                    {h.content}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- RAG — Спросить у памяти ---------- */}
      <section
        style={{
          marginTop: 24,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        <h3>RAG — Спросить у памяти</h3>

        <label>
          Вопрос:
          <textarea
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: 8 }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <label style={{ width: 140 }}>
            topK
            <input
              type="number"
              value={ragTopK}
              onChange={(e) => setRagTopK(Math.max(1, Number(e.target.value)))}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        <button onClick={askRag} disabled={ragLoading || !ragQuery.trim()} style={{ marginTop: 12 }}>
          {ragLoading ? "Ищем и отвечаем..." : "Спросить у памяти"}
        </button>

        {ragErr && (
          <div style={{ marginTop: 12, color: "#b00020" }}>
            <b>{ragErr}</b>
          </div>
        )}

        {ragAnswer && (
          <div style={{ marginTop: 16 }}>
            <h4>Ответ</h4>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                background: "#f7f7f7",
                padding: 12,
                borderRadius: 6,
              }}
            >
              {ragAnswer}
            </pre>
          </div>
        )}

        {ragSources.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4>Источники (по близости)</h4>
            <div style={{ display: "grid", gap: 10 }}>
              {ragSources.map((s) => (
                <div
                  key={s.id}
                  style={{ border: "1px solid #eee", borderRadius: 6, padding: 10 }}
                >
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {new Date(s.created_at).toLocaleString()} · distance:{" "}
                    <code>{(s.distance ?? 0).toFixed(3)}</code> · kind:{" "}
                    <code>{s.kind ?? "?"}</code>
                  </div>
                  {s.content && (
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        background: "#fafafa",
                        padding: 8,
                        borderRadius: 6,
                        marginTop: 6,
                      }}
                    >
                      {s.content}
                    </pre>
                  )}
                </div>
              ))}
            </div>
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
