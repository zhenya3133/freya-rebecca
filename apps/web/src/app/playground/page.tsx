// apps/web/src/app/playground/page.tsx
"use client";

import { useState } from "react";

type KPI = { name: string; target: number; unit?: string };

export default function PlaygroundPage() {
  const [goal, setGoal] = useState("Сделай план запуска ИИ-агентов для мастера маникюра в Минске");
  const [leads, setLeads] = useState(5);
  const [budgetUsd, setBudgetUsd] = useState(20);
  const [budgetTokens, setBudgetTokens] = useState(500000);
  const [deadline, setDeadline] = useState("2025-09-15");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initiative, setInitiative] = useState<any>(null);
  const [plan, setPlan] = useState<string>("");

  async function submit() {
    setLoading(true);
    setError(null);
    setInitiative(null);
    setPlan("");

    const kpi: KPI[] = [{ name: "Leads", target: leads, unit: "count" }];

    try {
      const res = await fetch("/api/freya/initiative", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          goal,
          kpi,
          budget: { usd: budgetUsd, tokens: budgetTokens },
          deadline
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json();
      setInitiative(data.initiative);
      setPlan(data.rebecca?.plan ?? "");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: "24px auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1>Freya Playground</h1>
      <p style={{ color: "#666" }}>Введи цель → Фрея создаст инициативу и попросит Ребекку выдать план.</p>

      <label style={{ display: "block", marginTop: 12 }}>
        Цель
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          style={{ width: "100%", minHeight: 90, marginTop: 6 }}
        />
      </label>

      <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <label>
          KPI Leads
          <input type="number" value={leads} onChange={(e) => setLeads(Number(e.target.value))} style={{ width: 120, marginLeft: 8 }} />
        </label>
        <label>
          Бюджет, $ 
          <input type="number" value={budgetUsd} onChange={(e) => setBudgetUsd(Number(e.target.value))} style={{ width: 120, marginLeft: 8 }} />
        </label>
        <label>
          Бюджет, tokens 
          <input type="number" value={budgetTokens} onChange={(e) => setBudgetTokens(Number(e.target.value))} style={{ width: 140, marginLeft: 8 }} />
        </label>
        <label>
          Дедлайн
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={{ marginLeft: 8 }} />
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={submit} disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Отправляю..." : "Отправить Фрее"}
        </button>
      </div>

      {error && (
        <pre style={{ color: "crimson", marginTop: 16, whiteSpace: "pre-wrap" }}>
          Ошибка: {error}
        </pre>
      )}

      {initiative && (
        <div style={{ marginTop: 20 }}>
          <h3>Инициатива</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(initiative, null, 2)}</pre>
        </div>
      )}

      {plan && (
        <div style={{ marginTop: 20 }}>
          <h3>План от Ребекки</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{plan}</pre>
        </div>
      )}
    </div>
  );
}
