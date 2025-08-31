"use client";

import React, { useEffect, useMemo, useState } from "react";

type Profile = {
  name: string;
  kind?: string;
  version?: string;
  role?: string;
  tags?: string[];
  style?: string;
  system?: string;
  params?: { temperature?: number; top_p?: number; max_tokens?: number };
  __source?: string;
};

type ListResp = { version: string; total: number; count: number; items: Profile[] };

export default function AdminProfilesPage() {
  const [items, setItems] = useState<Profile[]>([]);
  const [filter, setFilter] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState<Profile>({
    name: "",
    kind: "qa",
    style: "",
    system: "",
    params: { temperature: 0.2, top_p: 0.9, max_tokens: 700 },
    tags: [],
  });

  const filtered = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase();
    return items.filter((p) => JSON.stringify(p).toLowerCase().includes(q));
  }, [items, filter]);

  async function refresh() {
    const r = await fetch("/api/profiles/get");
    const j = (await r.json()) as ListResp;
    setItems(j.items || []);
  }

  useEffect(() => {
    refresh();
  }, []);

  function setField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/profiles/save", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsg(`Сохранено: ${(j.saved?.__source || j.saved?.name) ?? form.name}`);
      await refresh();
    } catch (e: any) {
      setMsg(`Ошибка: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function del(p: Profile) {
    if (!confirm(`Удалить профиль "${p.name}"?`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/profiles/delete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": adminKey || "" },
        body: JSON.stringify({ name: p.name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setMsg(`Удалено: ${j.deleted}`);
      await refresh();
    } catch (e: any) {
      setMsg(`Ошибка: ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  function edit(p: Profile) {
    setForm({
      name: p.name,
      kind: p.kind,
      version: p.version,
      role: p.role,
      tags: p.tags || [],
      style: p.style,
      system: p.system,
      params: p.params,
      __source: p.__source,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Admin · Profiles</h1>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Форма */}
        <div className="md:col-span-2 p-4 border rounded-2xl bg-white space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Admin Key (для сохранения/удаления)</label>
              <input className="w-full border rounded-xl px-3 py-2" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className="w-full border rounded-xl px-3 py-2" value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Kind</label>
              <input className="w-full border rounded-xl px-3 py-2" value={form.kind || ""} onChange={(e) => setField("kind", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tags (через запятую)</label>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={(form.tags || []).join(", ")}
                onChange={(e) => setField("tags", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">System</label>
              <textarea className="w-full border rounded-xl px-3 py-2 min-h-[90px]" value={form.system || ""} onChange={(e) => setField("system", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Style</label>
              <input className="w-full border rounded-xl px-3 py-2" value={form.style || ""} onChange={(e) => setField("style", e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Params.temperature</label>
              <input type="number" step="0.01" className="w-full border rounded-xl px-3 py-2"
                     value={form.params?.temperature ?? ""}
                     onChange={(e) => setField("params", { ...(form.params || {}), temperature: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Params.top_p</label>
              <input type="number" step="0.01" className="w-full border rounded-xl px-3 py-2"
                     value={form.params?.top_p ?? ""}
                     onChange={(e) => setField("params", { ...(form.params || {}), top_p: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Params.max_tokens</label>
              <input type="number" className="w-full border rounded-xl px-3 py-2"
                     value={form.params?.max_tokens ?? ""}
                     onChange={(e) => setField("params", { ...(form.params || {}), max_tokens: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={save} disabled={busy || !form.name.trim()} className="rounded-2xl px-4 py-2 border shadow disabled:opacity-50">
              {busy ? "Сохранение…" : "Сохранить"}
            </button>
            <button onClick={() => setForm({ name: "", kind: "qa", style: "", system: "", params: { temperature: 0.2, top_p: 0.9, max_tokens: 700 }, tags: [] })}
                    disabled={busy}
                    className="rounded-2xl px-4 py-2 border shadow">
              Новый
            </button>
          </div>

          {msg && <div className="text-sm mt-2 opacity-80">{msg}</div>}
        </div>

        {/* Список */}
        <div className="p-4 border rounded-2xl bg-white">
          <div className="mb-2">
            <input className="w-full border rounded-xl px-3 py-2" placeholder="Фильтр…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul className="space-y-2">
            {filtered.map((p) => (
              <li key={p.__source ?? p.name} className="border rounded-xl p-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs opacity-70">{p.__source}</div>
                    {p.tags?.length ? <div className="text-xs opacity-70">{p.tags.join(", ")}</div> : null}
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 border rounded-xl" onClick={() => edit(p)}>Редактировать</button>
                    <button className="px-3 py-1 border rounded-xl" onClick={() => del(p)}>Удалить</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
