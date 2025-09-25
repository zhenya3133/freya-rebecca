// apps/web/src/app/admin/logs/page.tsx
"use client";

import React from "react";

type LogItem = {
  id: string;
  kind: string;
  ns: string | null;
  profile: string | null;
  params: any | null;
  request: any | null;
  response: any | null;
  created_at: string;
};

export default function AdminLogsPage() {
  const [adminKey, setAdminKey] = React.useState<string>("");
  const [ns, setNs] = React.useState<string>("");
  const [kind, setKind] = React.useState<string>("");
  const [profile, setProfile] = React.useState<string>("");
  const [since, setSince] = React.useState<string>("");
  const [limit, setLimit] = React.useState<number>(20);

  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<LogItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  // Загружаем сохранённые параметры из sessionStorage
  React.useEffect(() => {
    const s = sessionStorage.getItem("admin.logs.state");
    if (s) {
      try {
        const v = JSON.parse(s);
        setAdminKey(v.adminKey ?? "");
        setNs(v.ns ?? "");
        setKind(v.kind ?? "");
        setProfile(v.profile ?? "");
        setSince(v.since ?? "");
        setLimit(v.limit ?? 20);
      } catch {}
    }
  }, []);

  // Сохраняем параметры
  const persist = React.useCallback(() => {
    sessionStorage.setItem(
      "admin.logs.state",
      JSON.stringify({ adminKey, ns, kind, profile, since, limit })
    );
  }, [adminKey, ns, kind, profile, since, limit]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (ns) sp.set("ns", ns);
      if (kind) sp.set("kind", kind);
      if (profile) sp.set("profile", profile);
      if (since) sp.set("since", since);
      sp.set("limit", String(limit));

      const res = await fetch(`/api/admin/logs/list?${sp.toString()}`, {
        method: "GET",
        headers: adminKey ? { "x-admin-key": adminKey } : undefined,
        cache: "no-store",
      });

      const js = await res.json();
      if (!res.ok || !js?.ok) {
        setError(String(js?.error || `HTTP ${res.status}`));
        setItems([]);
      } else {
        setItems(js.items as LogItem[]);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setItems([]);
    } finally {
      setLoading(false);
      persist();
    }
  }, [adminKey, ns, kind, profile, since, limit, persist]);

  const clearAndLoad = () => {
    setNs("");
    setKind("");
    setProfile("");
    setSince("");
    setLimit(20);
    setTimeout(load, 0);
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Admin · Logs</h1>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <label className="flex flex-col md:col-span-2">
          <span className="text-sm text-gray-600 mb-1">Admin Key</span>
          <input
            type="password"
            className="border rounded px-3 py-2"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="вставьте x-admin-key"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-gray-600 mb-1">ns</span>
          <input
            className="border rounded px-3 py-2"
            value={ns}
            onChange={(e) => setNs(e.target.value)}
            placeholder="например: rebecca/docs"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-gray-600 mb-1">kind</span>
          <input
            className="border rounded px-3 py-2"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="rag.answer / rag.answer.guarded / ..."
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-gray-600 mb-1">profile</span>
          <input
            className="border rounded px-3 py-2"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            placeholder="qa / list / json / code / spec"
          />
        </label>

        <label className="flex flex-col md:col-span-2">
          <span className="text-sm text-gray-600 mb-1">since (ISO)</span>
          <input
            className="border rounded px-3 py-2"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            placeholder="2025-08-29T00:00:00Z"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-sm text-gray-600 mb-1">limit</span>
          <input
            type="number"
            className="border rounded px-3 py-2"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            min={1}
            max={200}
          />
        </label>

        <div className="flex gap-3 md:col-span-2">
          <button
            onClick={load}
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={loading}
          >
            {loading ? "Загрузка..." : "Загрузить"}
          </button>
          <button
            onClick={clearAndLoad}
            className="px-4 py-2 rounded border"
            disabled={loading}
          >
            Сбросить фильтры
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 border border-red-300 bg-red-50 rounded text-sm text-red-700">
          Ошибка: {error}
        </div>
      )}

      <div className="space-y-3">
        {items.length === 0 && !loading && !error && (
          <div className="text-sm text-gray-500">Записей нет.</div>
        )}
        {items.map((it) => (
          <details key={it.id} className="border rounded p-3">
            <summary className="cursor-pointer select-none">
              <span className="font-mono text-xs text-gray-500">{new Date(it.created_at).toLocaleString()}</span>{" "}
              <span className="px-2 py-0.5 text-xs rounded bg-gray-100 border">{it.kind}</span>{" "}
              <span className="text-gray-700">{it.ns}</span>{" "}
              {it.profile ? <em className="text-gray-500">[{it.profile}]</em> : null}
              {" · "}
              <span className="text-gray-500">id:</span>
              <span className="font-mono text-xs"> {it.id}</span>
            </summary>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="md:col-span-1">
                <h3 className="font-medium mb-1">params</h3>
                <pre className="bg-gray-50 border rounded p-2 overflow-auto">{JSON.stringify(it.params, null, 2)}</pre>
              </div>
              <div className="md:col-span-1">
                <h3 className="font-medium mb-1">request</h3>
                <pre className="bg-gray-50 border rounded p-2 overflow-auto">{JSON.stringify(it.request, null, 2)}</pre>
              </div>
              <div className="md:col-span-1">
                <h3 className="font-medium mb-1">response</h3>
                <pre className="bg-gray-50 border rounded p-2 overflow-auto">{JSON.stringify(it.response, null, 2)}</pre>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
