/* apps/web/src/app/admin/ingest/page.tsx
   Простая админ-страница для загрузки URL в выбранный ns.
   Делает POST на /api/ingest/url, показывает сводку, ошибки и «быстрый тест RAG».
*/

"use client";

import { useCallback, useMemo, useState } from "react";

type IngestResult =
  | {
      ok: true;
      ns: string;
      url: string;
      slot: string;
      kind: string;
      stats: { length: number; chunks: number; inserted: number; skipped: number };
    }
  | { ok: false; error: string };

export default function AdminIngestPage() {
  const [adminKey, setAdminKey] = useState("");
  const [ns, setNs] = useState("rebecca/docs");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState("web");
  const [asMarkdown, setAsMarkdown] = useState(true);
  const [slot, setSlot] = useState("prod");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);

  const canSubmit = useMemo(() => ns.trim() && url.trim(), [ns, url]);

  const doIngest = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(adminKey ? { "x-admin-key": adminKey } : {}),
        },
        body: JSON.stringify({ ns, url, kind, asMarkdown, slot }),
      });
      const json: IngestResult = await res.json();
      setResult(json);
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [adminKey, asMarkdown, canSubmit, kind, ns, slot, url]);

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <h1>Admin · Ingest</h1>

      <section style={{ marginTop: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "#666" }}>
          Admin Key (необязательно)
        </label>
        <input
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          placeholder="x-admin-key"
          style={{ width: 320 }}
        />
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, marginTop: 12 }}>
        <label>Namespace (ns)</label>
        <input value={ns} onChange={(e) => setNs(e.target.value)} />

        <label>URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
        />

        <label>Kind</label>
        <input value={kind} onChange={(e) => setKind(e.target.value)} />

        <label>Slot</label>
        <input value={slot} onChange={(e) => setSlot(e.target.value)} />

        <label>Парсить как Markdown</label>
        <input
          type="checkbox"
          checked={asMarkdown}
          onChange={(e) => setAsMarkdown(e.target.checked)}
          style={{ width: 18, height: 18, alignSelf: "center" }}
        />
      </section>

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button onClick={doIngest} disabled={!canSubmit || loading}>
          {loading ? "Ингест…" : "Ингест URL"}
        </button>
        <button onClick={() => setResult(null)} disabled={loading}>
          Очистить результат
        </button>
      </div>

      <section style={{ marginTop: 16 }}>
        <h3>Результат</h3>
        <pre
          style={{
            background: "#f6f8fa",
            padding: 12,
            borderRadius: 6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {result ? JSON.stringify(result, null, 2) : "—"}
        </pre>
      </section>

      <details style={{ marginTop: 16 }}>
        <summary>Подсказки</summary>
        <ul>
          <li>Если видите <code>content too short</code> — страница почти пустая или динамическая.</li>
          <li>
            Readability выделяет «статью». Для лендингов и каталогов лучше снять галку «Парсить как
            Markdown».
          </li>
          <li>
            Дедуп делается по <code>content_hash</code> в рамках выбранного <code>ns</code>.
          </li>
        </ul>
      </details>
    </main>
  );
}
