// apps/web/src/app/admin/memory/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Item = {
  id: string;
  corpus_id: string;
  ns: string;
  slot: 'staging' | 'prod';
  created_at: string;
  title: string | null;
  kind: string | null;
  metadata: any;
  preview?: string;
  content_len: number;
};

type ListResp = {
  ok: boolean;
  ns: string;
  slot: 'staging' | 'prod';
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  items: Item[];
};

export default function Page() {
  const [ns, setNs] = useState('rebecca/army/agents');
  const [slot, setSlot] = useState<'staging' | 'prod'>('staging');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [limit, setLimit] = useState(20);
  const [order, setOrder] = useState<'asc'|'desc'>('desc');
  const [adminKey, setAdminKey] = useState(''); // для удаления
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ListResp | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([,v]) => v).map(([k]) => k),
    [selected]
  );

  async function load(offset = 0) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ ns, slot, limit: String(limit), order });
      if (q.trim()) params.set('q', q.trim());
      if (kind.trim()) params.set('kind', kind.trim());
      if (offset) params.set('offset', String(offset));
      const res = await fetch(`/api/memory/list?${params.toString()}`);
      const json = await res.json();
      setData(json);
      setSelected({});
    } finally {
      setLoading(false);
    }
  }

  async function deleteSelected() {
    if (!adminKey) { alert('Введите Admin Key (локально: dev-12345)'); return; }
    if (selectedIds.length === 0) { alert('Ничего не выбрано'); return; }
    if (!confirm(`Удалить ${selectedIds.length} записей?`)) return;

    const res = await fetch('/api/memory/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ ids: selectedIds, slot }),
    });
    const json = await res.json();
    if (!json.ok) { alert(json.error || 'Delete failed'); return; }
    await load(0);
  }

  async function deleteByFilter() {
    if (!adminKey) { alert('Введите Admin Key'); return; }
    const body: any = { ns, slot, limit: 100 };
    if (q.trim()) body.q = q.trim();
    if (kind.trim()) body.kind = kind.trim();

    // dry-run
    const check = await fetch('/api/memory/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify({ ...body, dryRun: true }),
    }).then(r => r.json());

    if (!check.ok) { alert(check.error || 'Dry run failed'); return; }
    const n = check.wouldDelete ?? check.totalMatches ?? 0;
    if (n === 0) { alert('Нечего удалять по фильтру'); return; }

    if (!confirm(`Будет удалено до ${n} записей. Продолжить?`)) return;

    const res = await fetch('/api/memory/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) { alert(json.error || 'Delete failed'); return; }
    await load(0);
  }

  useEffect(() => { load(0); }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Memory Admin</h1>

      <div className="grid md:grid-cols-2 gap-3">
        <L label="Namespace (ns)">
          <input className="w-full border rounded p-2" value={ns} onChange={e=>setNs(e.target.value)} />
        </L>
        <L label="Slot">
          <select className="w-full border rounded p-2" value={slot} onChange={e=>setSlot(e.target.value as any)}>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
          </select>
        </L>
        <L label="Search (q)">
          <input className="w-full border rounded p-2" value={q} onChange={e=>setQ(e.target.value)} />
        </L>
        <L label="Kind (source->>'kind')">
          <input className="w-full border rounded p-2" value={kind} onChange={e=>setKind(e.target.value)} />
        </L>
        <L label="Limit">
          <input className="w-full border rounded p-2" type="number" value={limit} onChange={e=>setLimit(Number(e.target.value||20))} />
        </L>
        <L label="Order">
          <select className="w-full border rounded p-2" value={order} onChange={e=>setOrder(e.target.value as any)}>
            <option value="desc">new → old</option>
            <option value="asc">old → new</option>
          </select>
        </L>
        <L label="Admin Key (для удаления)" full>
          <input className="w-full border rounded p-2" placeholder="dev-12345" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
        </L>
      </div>

      <div className="flex gap-2">
        <Btn onClick={()=>load(0)} disabled={loading}>{loading ? 'Loading…' : 'Load'}</Btn>
        <Btn outlined onClick={deleteSelected}>Delete selected</Btn>
        <Btn outlined onClick={deleteByFilter}>Delete by filter (dry-run)</Btn>
      </div>

      <div className="text-sm text-gray-500">
        total: {data?.total ?? 0} — showing {data?.items?.length ?? 0}
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2">
                <input type="checkbox"
                  checked={(data?.items?.length ?? 0) > 0 && (data?.items ?? []).every(it => selected[it.id])}
                  onChange={e => {
                    const on = e.target.checked;
                    const next: Record<string, boolean> = {};
                    (data?.items ?? []).forEach(it => next[it.id] = on);
                    setSelected(next);
                  }}
                />
              </th>
              <th className="p-2">Title</th>
              <th className="p-2">Kind</th>
              <th className="p-2">Created</th>
              <th className="p-2">Len</th>
              <th className="p-2">ID</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map(it => (
              <tr key={it.id} className="border-t">
                <td className="p-2">
                  <input
                    type="checkbox"
                    checked={!!selected[it.id]}
                    onChange={e => setSelected(s => ({ ...s, [it.id]: e.target.checked }))}
                  />
                </td>
                <td className="p-2">{it.title ?? <span className="text-gray-400">—</span>}</td>
                <td className="p-2">{it.kind ?? '—'}</td>
                <td className="p-2 whitespace-nowrap">{it.created_at}</td>
                <td className="p-2 text-right">{it.content_len}</td>
                <td className="p-2 font-mono text-xs">{it.id}</td>
              </tr>
            ))}
            {(data?.items?.length ?? 0) === 0 && (
              <tr><td className="p-4 text-center text-gray-500" colSpan={6}>нет данных</td></tr>
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
  return (
    <button
      className={`px-4 py-2 rounded ${outlined ? 'border' : 'bg-black text-white'} disabled:opacity-50`}
      {...rest}
    >
      {children}
    </button>
  );
}
