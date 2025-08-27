'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Row = {
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

type ListResp = {
  ok: boolean;
  ns?: string;
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  items: Row[];
  error?: string;
};

type TraceFull = {
  id: string;
  ns: string;
  query: string;
  profile?: string | null;
  model?: string | null;
  answer?: string | null;
  matches?: any;
  sources?: any;
  ok: boolean;
  error?: string | null;
  latency_ms?: number | null;
  meta?: any;
  created_at: string;
};

export default function Page() {
  const [baseUrl] = useState(''); // относительные вызовы
  const [ns, setNs] = useState('rebecca/army/agents');
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [q, setQ] = useState('');
  const [adminKey, setAdminKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ListResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [opened, setOpened] = useState<TraceFull | null>(null);
  const headers = useMemo(() => adminKey ? { 'X-Admin-Key': adminKey } : undefined, [adminKey]);

  async function load(nextOffset = 0) {
    if (!adminKey) { setError('Введите Admin Key (локально: dev-12345)'); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ ns, limit: String(limit), offset: String(nextOffset) });
      if (onlyErrors) params.set('onlyErrors','1');
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`${baseUrl}/api/evals/traces?${params.toString()}`, { headers });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'List failed');
      setData(json);
      setOffset(nextOffset);
    } catch (e:any) {
      setError(e?.message ?? 'List failed');
    } finally {
      setLoading(false);
    }
  }

  async function openTrace(id: string) {
    if (!adminKey) { alert('Введите Admin Key'); return; }
    const res = await fetch(`/api/evals/trace?id=${encodeURIComponent(id)}`, { headers });
    const json = await res.json();
    if (!json.ok) { alert(json.error || 'Load failed'); return; }
    setOpened(json.item as TraceFull);
  }

  useEffect(() => { /* авто-старт не делаем без ключа */ }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Traces</h1>

      <div className="grid md:grid-cols-2 gap-3">
        <L label="Namespace (ns)">
          <input className="w-full border rounded p-2" value={ns} onChange={e=>setNs(e.target.value)} />
        </L>
        <L label="Admin Key">
          <input className="w-full border rounded p-2" placeholder="dev-12345" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
        </L>
        <L label="Search in query">
          <input className="w-full border rounded p-2" value={q} onChange={e=>setQ(e.target.value)} />
        </L>
        <L label="Limit">
          <input type="number" className="w-full border rounded p-2" value={limit} onChange={e=>setLimit(Number(e.target.value||20))} />
        </L>
        <L label="Filters" full>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={onlyErrors} onChange={e=>setOnlyErrors(e.target.checked)} />
            <span>Only errors</span>
          </label>
        </L>
      </div>

      <div className="flex gap-2">
        <Btn onClick={()=>load(0)} disabled={loading}>{loading ? 'Loading…' : 'Load'}</Btn>
        <Btn outlined onClick={()=>{ if (data?.nextOffset!=null) load(data.nextOffset); }}>Next →</Btn>
        <Btn outlined onClick={()=>{ const prev = Math.max(0, offset - (data?.limit ?? limit)); load(prev); }}>← Prev</Btn>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Time</Th>
              <Th>OK</Th>
              <Th>Latency</Th>
              <Th>Model</Th>
              <Th>Query</Th>
              <Th>Answer (preview)</Th>
              <Th>ID</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map(it => (
              <tr key={it.id} className="border-t">
                <Td className="whitespace-nowrap">{it.created_at}</Td>
                <Td>{it.ok ? <span className="text-green-600">OK</span> : <span className="text-red-600">FAIL</span>}</Td>
                <Td className="text-right">{it.latency_ms ?? '—'} ms</Td>
                <Td>{it.model ?? '—'}</Td>
                <Td className="max-w-[24rem] truncate" title={it.query}>{it.query}</Td>
                <Td className="max-w-[24rem] truncate" title={it.answer_preview ?? ''}>{it.answer_preview ?? '—'}</Td>
                <Td className="font-mono text-xs">{it.id}</Td>
                <Td><a className="text-blue-600 cursor-pointer" onClick={()=>openTrace(it.id)}>view</a></Td>
              </tr>
            ))}
            {(data?.items?.length ?? 0) === 0 && (
              <tr><td className="p-4 text-center text-gray-500" colSpan={8}>нет данных</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {opened && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4" onClick={()=>setOpened(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">Trace {opened.id}</div>
              <button className="px-3 py-1 border rounded" onClick={()=>setOpened(null)}>Close</button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <KV k="ns" v={opened.ns} />
              <KV k="time" v={opened.created_at} />
              <KV k="ok" v={String(opened.ok)} />
              <KV k="latency_ms" v={String(opened.latency_ms ?? '')} />
              <KV k="model" v={opened.model ?? '—'} />
              <KV k="profile" v={opened.profile ?? '—'} />
              <Block label="query" text={opened.query} />
              <Block label="answer" text={opened.answer ?? ''} />
              <JsonBlock label="matches" obj={opened.matches} />
              <JsonBlock label="sources" obj={opened.sources} />
              <KV k="error" v={opened.error ?? ''} />
              <JsonBlock label="meta" obj={opened.meta} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function L({label, children, full=false}:{label:string, children:React.ReactNode, full?:boolean}) {
  return (
    <div className={`space-y-2 ${full ? 'md:col-span-2' : ''}`}>
      <label className="block text-sm">{label}</label>
      {children}
    </div>
  );
}
function Btn({children, outlined, ...rest}:{children:React.ReactNode, outlined?:boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`px-4 py-2 rounded ${outlined ? 'border' : 'bg-black text-white'} disabled:opacity-50`} {...rest}>{children}</button>;
}
function Th({children}:{children:React.ReactNode}) { return <th className="p-2 text-left">{children}</th>; }
function Td({children, className=''}:{children:React.ReactNode, className?:string}) { return <td className={`p-2 ${className}`}>{children}</td>; }

function KV({k, v}:{k:string, v:string}) {
  return (
    <div className="grid grid-cols-12 gap-2">
      <div className="col-span-3 text-gray-500">{k}</div>
      <div className="col-span-9">{v}</div>
    </div>
  );
}
function Block({label, text}:{label:string, text:string}) {
  return (
    <div>
      <div className="text-gray-500 mb-1">{label}</div>
      <pre className="whitespace-pre-wrap text-xs border rounded p-2 bg-gray-50">{text || '—'}</pre>
    </div>
  );
}
function JsonBlock({label, obj}:{label:string, obj:any}) {
  let pretty = '—';
  try { pretty = obj ? JSON.stringify(obj, null, 2) : '—'; } catch {}
  return (
    <div>
      <div className="text-gray-500 mb-1">{label}</div>
      <pre className="text-xs border rounded p-2 bg-gray-50 overflow-x-auto">{pretty}</pre>
    </div>
  );
}
