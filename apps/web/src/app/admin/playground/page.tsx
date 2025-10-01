'use client';

import React, { useEffect, useMemo, useState } from 'react';

type ProfileDoc = {
  id: string;
  content?: any;
  title?: string | null;
  created_at: string;
};
type ListResp = {
  ok: boolean; items: ProfileDoc[];
};

type AskResp = {
  ok: boolean;
  answer?: string;
  sources?: any;
  matches?: any;
  logId?: string;
  error?: string;
};

export default function Page() {
  // defaults
  const [ns, setNs] = useState('rebecca/army/agents');         // куда искать знания
  const [profilesNs, setProfilesNs] = useState('rebecca/profiles'); // где лежат профили
  const [slot, setSlot] = useState<'prod'|'staging'>('prod');
  const [query, setQuery] = useState('Кто такая Rebecca? Коротко.');
  const [profile, setProfile] = useState('qa');
  const [model, setModel] = useState('gpt-4o-mini');
  const [topK, setTopK] = useState(5);
  const [minScore, setMinScore] = useState(0.1);
  const [maxTokens, setMaxTokens] = useState(300);
  const [loading, setLoading] = useState(false);

  const [profiles, setProfiles] = useState<string[]>([]);
  const [result, setResult] = useState<AskResp | null>(null);
  const [adminKey, setAdminKey] = useState('');

  async function loadProfiles() {
    // тянем профили прямо из публичного /api/memory/list (full=1, kind=rebecca/profile)
    const p = new URLSearchParams({
      ns: profilesNs,
      slot,
      kind: 'rebecca/profile',
      full: '1',
      limit: '100',
      order: 'desc',
    });
    const res = await fetch(`/api/memory/list?${p.toString()}`);
    const json: ListResp = await res.json();
    const names = (json.items ?? []).map((it) => {
      const c = it.content;
      if (typeof c === 'string') {
        try { return JSON.parse(c)?.name as string; } catch { return undefined; }
      }
      return c?.name as string;
    }).filter(Boolean) as string[];
    // уникалим
    setProfiles(Array.from(new Set(names)));
    if (!names.includes(profile) && names.length) setProfile(names[0]);
  }

  async function ask() {
    setLoading(true);
    setResult(null);
    try {
      const body = {
        query, ns, topK, minScore, maxTokens, model, profile,
        // передадим явным образом, если на бэке уже есть поддержка выбора slot/NS для профилей:
        profilesNs, profilesSlot: slot,
      };
      const res = await fetch('/api/rag/answer-logged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: AskResp = await res.json();
      setResult(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProfiles(); /* eslint-disable-next-line */ }, [profilesNs, slot]);

  const traceUrl = useMemo(() => result?.logId ? `/admin/traces?id=${result.logId}` : null, [result?.logId]);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Playground</h1>

      <div className="grid md:grid-cols-3 gap-3">
        <L label="NS (where to search)">
          <input className="w-full border rounded p-2" value={ns} onChange={e=>setNs(e.target.value)} />
        </L>
        <L label="Profiles NS">
          <input className="w-full border rounded p-2" value={profilesNs} onChange={e=>setProfilesNs(e.target.value)} />
        </L>
        <L label="Slot">
          <select className="w-full border rounded p-2" value={slot} onChange={e=>setSlot(e.target.value as any)}>
            <option value="prod">prod</option>
            <option value="staging">staging</option>
          </select>
        </L>

        <L label="Profile">
          <div className="flex gap-2">
            <select className="border rounded p-2 flex-1" value={profile} onChange={e=>setProfile(e.target.value)}>
              {profiles.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <button className="border rounded px-3" onClick={loadProfiles}>↻</button>
          </div>
        </L>
        <L label="Model">
          <input className="w-full border rounded p-2" value={model} onChange={e=>setModel(e.target.value)} />
        </L>
        <L label="Params">
          <div className="flex gap-2">
            <I label="topK" val={topK} set={setTopK} />
            <I label="minScore" val={minScore} set={setMinScore} step={0.01} />
            <I label="maxTokens" val={maxTokens} set={setMaxTokens} />
          </div>
        </L>

        <L label="Admin Key (для /admin/traces ссылки, необязательно)">
          <input className="w-full border rounded p-2" placeholder="dev-12345" value={adminKey} onChange={e=>setAdminKey(e.target.value)} />
        </L>

        <div className="md:col-span-3">
          <label className="block text-sm mb-2">Query</label>
          <textarea className="w-full border rounded p-2 h-28" value={query} onChange={e=>setQuery(e.target.value)} />
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={ask} disabled={loading}>{loading ? 'Asking…' : 'Ask & Log'}</Btn>
        {traceUrl && (
          <a className="px-4 py-2 rounded border" href={`${traceUrl}${adminKey ? `&adminKey=${encodeURIComponent(adminKey)}`:''}`} target="_blank">Open Trace</a>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          {!result.ok && <div className="text-red-600">Error: {result.error}</div>}
          {result.answer && (
            <div>
              <div className="text-sm text-gray-600 mb-1">Answer</div>
              <pre className="p-3 border rounded bg-gray-50 whitespace-pre-wrap">{result.answer}</pre>
            </div>
          )}
          {result.sources && (
            <div>
              <div className="text-sm text-gray-600 mb-1">Sources</div>
              <pre className="p-3 border rounded bg-white overflow-auto">{JSON.stringify(result.sources, null, 2)}</pre>
            </div>
          )}
          {result.matches && (
            <div>
              <div className="text-sm text-gray-600 mb-1">Matches</div>
              <pre className="p-3 border rounded bg-white overflow-auto">{JSON.stringify(result.matches, null, 2)}</pre>
            </div>
          )}
          {result.logId && (
            <div className="text-sm">logId: <span className="font-mono">{result.logId}</span></div>
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
function I({label, val, set, step=1}:{label:string, val:number, set:(n:number)=>void, step?:number}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">{label}</span>
      <input type="number" step={step as any} className="w-24 border rounded p-2"
        value={val} onChange={e=>set(Number(e.target.value||0))} />
    </div>
  );
}
function Btn({children, outlined, ...rest}:{children:React.ReactNode, outlined?:boolean} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`px-4 py-2 rounded ${outlined ? 'border' : 'bg-black text-white'} disabled:opacity-50`} {...rest}>
      {children}
    </button>
  );
}
