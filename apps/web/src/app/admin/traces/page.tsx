"use client";

import React, { useEffect, useMemo, useState } from "react";

type TraceLite = {
  id: string;
  ns: string;
  query: string;
  profile?: string | null;
  model?: string | null;
  ok: boolean;
  error?: string | null;
  latency_ms?: number | null;
  created_at: string;
  answer_preview?: string | null;
};

type TraceList = {
  ok: boolean;
  ns: string;
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  items: TraceLite[];
};

type TraceFull = {
  id: string;
  ns: string;
  query: string;
  profile?: string | null;
  model?: string | null;
  ok: boolean;
  error?: string | null;
  latency_ms?: number | null;
  created_at: string;
  answer?: string | null;
  matches?: any;
  sources?: any;
  meta?: any;
};

export default function Page() {
  // ---- controls ----
  const [adminKey, setAdminKey] = useState("");
  const [ns, setNs] = useState("rebecca/army/agents");
  const [profile, setProfile] = useState("");
  const [model, setModel] = useState("");
  const [okFilter, setOkFilter] = useState<"all"|"ok"|"fail">("all");
  const [limit, setLimit] = useState(20);

  // ---- data ----
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<TraceList | null>(null);
  const [detail, setDetail] = useState<TraceFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  // persist AdminKey & ns в localStorage
  useEffect(() => {
    const ak = localStorage.getItem("adminKey") || "";
    const savedNs = localStorage.getItem("traces.ns") || "";
    const savedProfile = localStorage.getItem("traces.profile") || "";
    const savedModel = localStorage.getItem("traces.model") || "";
    const savedOk = (localStorage.getItem("traces.ok") as any) || "all";
    if (ak) setAdminKey(ak);
    if (savedNs) setNs(savedNs);
    if (savedProfile) setProfile(savedProfile);
    if (savedModel) setModel(savedModel);
    if (savedOk === "ok" || savedOk === "fail" || savedOk === "all") setOkFilter(savedOk);
  }, []);
  useEffect(() => { localStorage.setItem("adminKey", adminKey); }, [adminKey]);
  useEffect(() => { localStorage.setItem("traces.ns", ns); }, [ns]);
  useEffect(() => { localStorage.setItem("traces.profile", profile); }, [profile]);
  useEffect(() => { localStorage.setItem("traces.model", model); }, [model]);
  useEffect(() => { localStorage.setItem("traces.ok", okFilter); }, [okFilter]);

  async function load(offset = 0) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ ns, limit: String(limit), offset: String(offset) });
      // Если бэкенд поддерживает серверные фильтры — передадим.
      if (profile.trim()) p.set("profile", profile.trim());
      if (model.trim())   p.set("model", model.trim());
      if (okFilter !== "all") p.set("ok", okFilter === "ok" ? "1" : "0");

      const res = await fetch(`/api/evals/traces?${p.toString()}`, {
        headers: { "X-Admin-Key": adminKey || "" },
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setList(json);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openTrace(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/evals/trace?id=${encodeURIComponent(id)}`, {
        headers: { "X-Admin-Key": adminKey || "" },
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail(json.item as TraceFull);
    } catch (e: any) {
      setError(e.message || String(e));
    }
  }

  // доп. клиентская фильтрация, если сервер не умеет
  const filtered = useMemo(() => {
    let items = list?.items ?? [];
    if (okFilter !== "all") items = items.filter(i => i.ok === (okFilter === "ok"));
    if (profile.trim()) items = items.filter(i => (i.profile || "").toLowerCase().includes(profile.toLowerCase()));
    if (model.trim())   items = items.filter(i => (i.model || "").toLowerCase().includes(model.toLowerCase()));
    return items;
  }, [list, okFilter, profile, model]);

  useEffect(() => { load(0); }, []); // on mount

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Eval Traces</h1>

      <div className="grid md:grid-cols-3 gap-3">
        <L label="Namespace (ns)">
          <input className="w-full border rounded p-2" value={ns} onChange={e=>setNs(e.target.value)} />
        </L>
        <L label="OK filter">
          <select className="w-full border rounded p-2" value={okFilter} onChange={e=>setOkFilter(e.target.value as any)}>
            <option value="all">all</option>
            <option value="ok">only OK</option>
            <option value="fail">only FAIL</option>
          </select>
        </L>
        <L label="Limit">
          <input type="number" className="w-full border rounded p-2" value={limit} onChange={e=>setLimit(Number(e.target.value||20))} />
        </L>
        <L label="Profile (contains)">
          <input className="w-full border rounded p-2" value={profile} onChange={e=>setProfile(e.target.value)} />
        </L>
        <L label="Model (contains)">
          <input className="w-full border rounded p-2" value={model} onChange={e=>setModel(e.target.value)} />
        </L>
        <L label="Admin Key" full>
          <input className="w-full border rounded p-2" placeholder="dev-12345" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
        </L>
      </div>

      <div className="flex gap-2">
        <Btn onClick={()=>load(0)} disabled={loading}>{loading ? "Loading…" : "Load"}</Btn>
        <Btn outlined disabled={!list || list.offset===0} onClick={()=>load(Math.max(0,(list?.offset??0)-(list?.limit??20)))}>← Prev</Btn>
        <Btn outlined disabled={!list || list.nextOffset===null} onClick={()=>load(list!.nextOffset!)}>Next →</Btn>
      </div>

      {error && <div className="text-red-600 text-sm">Error: {error}</div>}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Time</Th><Th>OK</Th><Th>Latency</Th><Th>Profile</Th><Th>Model</Th><Th>Query</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(it => (
              <tr key={it.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={()=>openTrace(it.id)}>
                <Td className="whitespace-nowrap">{it.created_at}</Td>
                <Td>{it.ok ? <span className="text-green-700">OK</span> : <span className="text-red-700">FAIL</span>}</Td>
                <Td className="text-right">{it.latency_ms ?? "—"} ms</Td>
                <Td>{it.profile ?? "—"}</Td>
                <Td>{it.model ?? "—"}</Td>
                <Td title={it.query}>{(it.answer_preview || it.query || "—").slice(0,120)}</Td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">нет записей</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Trace: {detail.id}</h2>
            <Btn outlined onClick={()=>setDetail(null)}>Close</Btn>
          </div>
          <KeyVal k="Time" v={detail.created_at} />
          <KeyVal k="NS" v={detail.ns} />
          <KeyVal k="Profile" v={detail.profile || "—"} />
          <KeyVal k="Model" v={detail.model || "—"} />
          <KeyVal k="OK" v={detail.ok ? "OK" : `FAIL: ${detail.error || ""}`} />
          <KeyVal k="Latency" v={(detail.latency_ms ?? 0) + " ms"} />
          <KVBlock k="Query" v={detail.query} />
          <KVBlock k="Answer">
            <pre className="whitespace-pre-wrap text-sm">{detail.answer || "—"}</pre>
          </KVBlock>
          {detail.sources && <KVBlock k="Sources"><pre className="text-xs overflow-x-auto">{JSON.stringify(detail.sources, null, 2)}</pre></KVBlock>}
          {detail.matches && <KVBlock k="Matches"><pre className="text-xs overflow-x-auto">{JSON.stringify(detail.matches, null, 2)}</pre></KVBlock>}
          {detail.meta && <KVBlock k="Meta"><pre className="text-xs overflow-x-auto">{JSON.stringify(detail.meta, null, 2)}</pre></KVBlock>}
        </div>
      )}
    </div>
  );
}

function L({label, children, full=false}:{label:string, children:React.ReactNode, full?:boolean}) {
  return (
    <div className={`space-y-2 ${full ? "md:col-span-3" : ""}`}>
      <label className="block text-sm">{label}</label>
      {children}
    </div>
  );
}
function Th({children}:{children:React.ReactNode}) { return <th className="p-2 text-left">{children}</th>; }
function Td({children,className=""}:{children:React.ReactNode,className?:string}) { return <td className={`p-2 ${className}`}>{children}</td>; }
function Btn({children, outlined, ...rest}:{children:React.ReactNode, outlined?:boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`px-4 py-2 rounded ${outlined ? "border" : "bg-black text-white"} disabled:opacity-50`} {...rest}>{children}</button>;
}
function KeyVal({k, v}:{k:string, v:string}) {
  return <div className="text-sm"><span className="text-gray-500">{k}: </span><span>{v}</span></div>;
}
function KVBlock({k, v, children}:{k:string, v?:string, children?:React.ReactNode}) {
  return (
    <div>
      <div className="text-sm text-gray-500 mb-1">{k}</div>
      {children ? children : <pre className="text-sm">{v || "—"}</pre>}
    </div>
  );
}