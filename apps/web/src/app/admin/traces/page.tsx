'use client';

import React, { useEffect, useMemo, useState } from 'react';

type TraceItem = {
  id: string;
  ns: string;
  query: string;
  profile: string | null;
  model: string | null;
  ok: boolean;
  error: string | null;
  latency_ms: number | null;
  created_at: string;
  answer_preview?: string | null;
};

type ListResp = {
  ok: boolean;
  ns: string;
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  items: TraceItem[];
};

export default function Page() {
  const [ns, setNs] = useState('rebecca/army/agents');
  const [adminKey, setAdminKey] = useState('');
  const [okOnly, setOkOnly] = useState<'' | '1' | '0'>('');
  const [profile, setProfile] = useState('');
  const [model, setModel] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [order, setOrder] = useState<'asc'|'desc'>('desc');
  const [limit, setLimit] = useState(20);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ListResp | null>(null);
  const [selected, setSelected] = useState<TraceItem | null>(null);

  async function load(offset=0) {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        ns, limit: String(limit), order, offset: String(offset)
      });
      if (okOnly) p.set('ok', okOnly);
      if (profile.trim()) p.set('profile', profile.trim());
      if (model.trim()) p.set('model', model.trim());
      if (q.trim()) p.set('q', q.trim());
      if (from.trim()) p.set('from', from.trim());
      if (to.trim()) p.set('to', to.trim());

      const res = await fetch(`/api/evals/traces?${p.toString()}`, {
        headers: adminKey ? { 'X-Admin-Key': adminKey } : undefined,
      });
      const json = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  async function openItem(it: TraceItem) {
    if (!adminKey) { alert('Введите Admin Key'); return; }
    const p = new URLSearchParams({ id: it.id });
    const res = await fetch(`/api/evals/trace?${p.toString()}`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    const json = await res.json();
    if (json.ok) setSelected(json.item);
    else alert(json.error || 'Failed to load trace');
  }

  const exportUrl = useMemo(() => {
    const p = new URLSearchParams({ ns, order, limit: String(5000) });
    if (okOnly) p.set('ok', okOnly);
    if (profile.trim()) p.set('profile', profile.trim());
    if (model.trim()) p.set('model', model.trim());
    if (q.trim()) p.set('q', q.trim());
    if (from.trim()) p.set('from', from.trim());
    if (to.trim()) p.set('to', to.trim());
    if (adminKey) p.set('adminKey', adminKey); // для скачивания через GET
    return `/api/evals/traces/export?${p.toString()}`;
  }, [ns, okOnly, profile, model, q, from, to, order, adminKey]);

  useEffect(() => { /* пусто */ }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Eval Traces</h1>

      <div className="grid md:grid-cols-3 gap-3">
        <L label="Namespace (ns)">
          <input className="w-full border rounded p-2" value={ns} onChange={e=>setNs(e.target.value)} />
        </L>
        <L label="Admin Key">
          <input className="w-full border rounded p-2" placeholder="dev-12345" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
        </L>
        <L label="OK">
          <select className="w-full border rounded p-2" value={okOnly} onChange={e=>setOkOnly(e.target.value as any)}>
            <option value="">all</option>
            <option value="1">ok = true</option>
            <option value="0">ok = false</option>
          </select>
        </L>
        <L label="Profile">
          <input className="w-full border rounded p-2" value={profile} onChange={e=>setProfile(e.target.value)} />
        </L>
        <L label="Model">
          <input className="w-full border rounded p-2" value={model} onChange={e=>setModel(e.target.value)} />
        </L>
        <L label="Search (query/answer/error)">
          <input className="w-full border rounded p-2" value={q} onChange={e=>setQ(e.target.value)} />
        </L>
        <L label="From (ISO)">
          <input className="w-full border rounded p-2" placeholder="2025-08-26" value={from} onChange={e=>setFrom(e.target.value)} />
        </L>
        <L label="To (ISO)">
          <input className="w-full border rounded p-2" placeholder="2025-08-27T23:59:59" value={to} onChange={e=>setTo(e.target.value)} />
        </L>
        <L label="Order / Limit">
          <div className="flex gap-2">
            <select className="border rounded p-2" value={order} onChange={e=>setOrder(e.target.value as any)}>
              <option value="desc">new → old</option>
              <option value="asc">old → new</option>
            </select>
            <input type="number" className="w-28 border rounded p-2" value={limit} onChange={e=>setLimit(Number(e.target.value||20))} />
          </div>
        </L>
      </div>

      <div className="flex gap-2">
        <Btn onClick={()=>load(0)} disabled={loading}>{loading ? 'Loading…' : 'Load'}</Btn>
        <Btn outlined onClick={()=>window.open(exportUrl, '_blank')}>Export CSV</Btn>
      </div>

      <div className="text-sm text-gray-500">
        total: {data?.total ?? 0} — showing {data?.items?.length ?? 0}
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2">Time</th>
              <th className="p-2">OK</th>
              <th className="p-2">Latency</th>
              <th className="p-2">Profile</th>
              <th className="p-2">Model</th>
              <th className="p-2">Query / Answer</th>
              <th className="p-2">ID</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map(it => (
              <tr key={it.id} className="border-t hover:bg-gray-50">
                <td className="p-2 whitespace-nowrap">{it.created_at}</td>
                <td className="p-2">{it.ok ? '✅' : '❌'}</td>
                <td className="p-2 text-right">{it.latency_ms ?? '—'} ms</td>
                <td className="p-2">{it.profile ?? '—'}</td>
                <td className="p-2">{it.model ?? '—'}</td>
                <td className="p-2">
                  <div className="line-clamp-2">{it.query}</div>
                  {it.answer_preview && <div className="text-gray-500 line-clamp-2">{it.answer_preview}</div>}
                  <button className="text-blue-600 underline mt-1" onClick={()=>openItem(it)}>Open</button>
                </td>
                <td className="p-2 font-mono text-xs">{it.id}</td>
              </tr>
            ))}
            {(data?.items?.length ?? 0) === 0 && (
              <tr><td className="p-4 text-center text-gray-500" colSpan={7}>нет данных</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Btn outlined
          disabled={!data || data.offset === 0}
          onClick={() => load(Math.max(0, (data?.offset ?? 0) - (data?.limit ?? 20)))}
        >← Prev</Btn>
        <Btn outlined
          disabled={!data || data.nextOffset === null}
          onClick={() => load(data!.nextOffset!)}
        >Next →</Btn>
      </div>

      {selected && (
        <div className="border rounded p-4 space-y-3 bg-gray-50">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold">Trace: {selected.id}</h2>
            <button className="text-sm underline" onClick={()=>setSelected(null)}>close</button>
          </div>
          <K label="created_at" value={selected.created_at} />
          <K label="ok" value={String((selected as any).ok)} />
          <K label="latency_ms" value={String((selected as any).latency_ms ?? '')} />
          <K label="profile" value={String((selected as any).profile ?? '')} />
          <K label="model" value={String((selected as any).model ?? '')} />
          <div>
            <div className="text-sm text-gray-600 mb-1">query</div>
            <pre className="p-2 bg-white border rounded whitespace-pre-wrap">{(selected as any).query}</pre>
          </div>
          {(selected as any).answer && (
            <div>
              <div className="text-sm text-gray-600 mb-1">answer</div>
              <pre className="p-2 bg-white border rounded whitespace-pre-wrap">{(selected as any).answer}</pre>
            </div>
          )}
          {(selected as any).error && (
            <div>
              <div className="text-sm text-gray-600 mb-1">error</div>
              <pre className="p-2 bg-white border rounded whitespace-pre-wrap text-red-600">{(selected as any).error}</pre>
            </div>
          )}
          {(selected as any).sources && (
            <div>
              <div className="text-sm text-gray-600 mb-1">sources (json)</div>
              <pre className="p-2 bg-white border rounded overflow-auto">{JSON.stringify((selected as any).sources, null, 2)}</pre>
            </div>
          )}
          {(selected as any).matches && (
            <div>
              <div className="text-sm text-gray-600 mb-1">matches (json)</div>
              <pre className="p-2 bg-white border rounded overflow-auto">{JSON.stringify((selected as any).matches, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function L({label, children}:{label:string, children:React.ReactNode}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm">{label}</label>
      {children}
    </div>
  );
}
function K({label, value}:{label:string, value:string}) {
  return <div className="text-sm"><span className="text-gray-600">{label}:</span> <span className="font-mono">{value}</span></div>;
}
function Btn({children, outlined, ...rest}:{children:React.ReactNode, outlined?:boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`px-4 py-2 rounded ${outlined ? 'border' : 'bg-black text-white'} disabled:opacity-50`} {...rest}>
      {children}
    </button>
  );
}
