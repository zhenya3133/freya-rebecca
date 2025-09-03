'use client';

import * as React from 'react';

type Source = { n: number; path?: string; url?: string; score: number };
type Match = { id: string; path?: string; url?: string; score: number; preview?: string };
type RagResponse = {
  ok: boolean;
  model?: string;
  mode?: string;
  profile?: string;
  answer?: string;
  sources?: Source[];
  matches?: Match[];
  error?: string;
  // некоторые маршруты могут возвращать logId / payload — не используем тут, но не ломаемся
  [k: string]: any;
};

type HistoryItem = {
  id: string;
  route: string;
  ts: number;
  ns: string;
  profileName: string;
  codeLang?: string;
  maxTokens: number;
  guarded: boolean;
  logged: boolean;
  timeoutMs: number;
  query: string;
  res?: RagResponse;
  ms?: number;
  err?: string;
};

const PROFILES = ['qa', 'json', 'code', 'list', 'spec'] as const;
type ProfileName = typeof PROFILES[number];

function deduceRoute(guarded: boolean, logged: boolean) {
  if (guarded && logged) return '/api/rag/answer-logged-guarded';
  if (guarded) return '/api/rag/answer-guarded';
  if (logged) return '/api/rag/answer-logged';
  return '/api/rag/answer';
}

// даём небольшой запас к таймауту, чтобы не обрывать ответ «на финишной прямой»
async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const budget = Math.max(1000, timeoutMs + 1500);
  const timer = setTimeout(() => ctrl.abort(), budget);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
    return (await res.json()) as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Превышен таймаут ${timeoutMs} мс — увеличьте "Timeout, ms" и повторите.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function useLocalStorage<T>(key: string, initial: T) {
  const [val, setVal] = React.useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }, [key, val]);
  return [val, setVal] as const;
}

export default function ChatPage() {
  // form state
  const [ns, setNs] = useLocalStorage('chat.ns', 'rebecca/docs');
  const [profileName, setProfileName] = useLocalStorage<ProfileName>('chat.profile', 'qa');
  const [codeLang, setCodeLang] = useLocalStorage('chat.codeLang', 'typescript');
  const [query, setQuery] = useLocalStorage('chat.query', 'Кратко: что делает Rebecca.Docs?');
  const [maxTokens, setMaxTokens] = useLocalStorage<number>('chat.maxTokens', 450);
  const [timeoutMs, setTimeoutMs] = useLocalStorage<number>('chat.timeoutMs', 18000);
  const [guarded, setGuarded] = useLocalStorage<boolean>('chat.guarded', true);
  const [logged, setLogged] = useLocalStorage<boolean>('chat.logged', true);

  // runtime
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [answer, setAnswer] = React.useState<string>('');
  const [sources, setSources] = React.useState<Source[]>([]);
  const [matches, setMatches] = React.useState<Match[]>([]);
  const [model, setModel] = React.useState<string>('');
  const [routeUsed, setRouteUsed] = React.useState<string>('');

  // history
  const [history, setHistory] = useLocalStorage<HistoryItem[]>('chat.history', []);

  const ask = async () => {
    setErr(null);
    setLoading(true);
    setAnswer('');
    setSources([]);
    setMatches([]);
    setModel('');
    const route = deduceRoute(guarded, logged);
    setRouteUsed(route);

    // разные роуты исторически принимали и profile, и profileName — передадим оба, чтобы не зависеть от версии
    const body: any = {
      ns,
      query,
      profileName,
      profile: profileName,
      codeLang,
      maxTokens,
    };

    const started = performance.now();
    try {
      const res = await fetchJsonWithTimeout<RagResponse>(
        route,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      const ms = Math.round(performance.now() - started);
      setModel(res.model ?? '');
      setAnswer(res.answer ?? '');
      setSources(res.sources ?? []);
      setMatches(res.matches ?? []);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          route,
          ts: Date.now(),
          ns,
          profileName,
          codeLang,
          maxTokens,
          guarded,
          logged,
          timeoutMs,
          query,
          res,
          ms,
        },
        ...prev.slice(0, 24),
      ]);
    } catch (e: any) {
      const ms = Math.round(performance.now() - started);
      const message = e?.message ? String(e.message) : 'Unknown error';
      setErr(message);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          route,
          ts: Date.now(),
          ns,
          profileName,
          codeLang,
          maxTokens,
          guarded,
          logged,
          timeoutMs,
          query,
          err: message,
          ms,
        },
        ...prev.slice(0, 24),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setAnswer('');
    setSources([]);
    setMatches([]);
    setErr(null);
    setModel('');
    setRouteUsed('');
  };

  const loadFromHistory = (h: HistoryItem) => {
    setNs(h.ns);
    setProfileName(h.profileName as ProfileName);
    setCodeLang(h.codeLang ?? 'typescript');
    setMaxTokens(h.maxTokens);
    setTimeoutMs(h.timeoutMs);
    setGuarded(h.guarded);
    setLogged(h.logged);
    setQuery(h.query);
    reset();
  };

  const copyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(answer || '');
      alert('Ответ скопирован в буфер обмена');
    } catch {
      alert('Не удалось скопировать');
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1 style={{ marginTop: 0 }}>Chat · RAG с профилями</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center', maxWidth: 980 }}>
        <label>
          <div>Namespace (ns)</div>
          <input value={ns} onChange={(e) => setNs(e.target.value)} style={{ width: '100%' }} />
        </label>

        <label>
          <div>Профиль</div>
          <select
            value={profileName}
            onChange={(e) => setProfileName(e.target.value as ProfileName)}
            style={{ width: '100%' }}
          >
            {PROFILES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>

        <label style={{ gridColumn: '1 / -1' }}>
          <div>Вопрос</div>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
          />
        </label>

        <label>
          <div>Timeout, ms</div>
          <input
            type="number"
            min={1000}
            step={500}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value || 0))}
          />
        </label>

        <label>
          <div>maxTokens</div>
          <input
            type="number"
            min={64}
            step={50}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value || 0))}
          />
        </label>

        <label>
          <div>Guarded</div>
          <input type="checkbox" checked={guarded} onChange={(e) => setGuarded(e.target.checked)} />
        </label>

        <label>
          <div>Logged</div>
          <input type="checkbox" checked={logged} onChange={(e) => setLogged(e.target.checked)} />
        </label>

        {profileName === 'code' && (
          <label>
            <div>Язык кода</div>
            <input value={codeLang} onChange={(e) => setCodeLang(e.target.value)} />
          </label>
        )}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button onClick={ask} disabled={loading} style={{ padding: '6px 12px' }}>
          {loading ? 'Ждём…' : 'Спросить'}
        </button>
        <button onClick={reset} disabled={loading} style={{ padding: '6px 12px' }}>
          Сброс
        </button>
        <button onClick={copyAnswer} disabled={!answer} style={{ padding: '6px 12px' }}>
          Копировать ответ
        </button>
      </div>

      {/* статус/диагностика */}
      <div style={{ marginTop: 8, color: '#666' }}>
        {routeUsed ? <span>Маршрут: <code>{routeUsed}</code> · </span> : null}
        {model ? <span>Модель: <code>{model}</code> · </span> : null}
        {loading ? <span>Выполняется запрос…</span> : null}
      </div>

      {/* ошибка */}
      {err && (
        <div style={{ marginTop: 12, padding: 12, background: '#ffeaea', border: '1px solid #f5c2c2' }}>
          <b>Ошибка:</b> {err}
        </div>
      )}

      {/* ответ */}
      {answer && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Ответ</h3>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#fafafa',
              border: '1px solid #eee',
              padding: 12,
              borderRadius: 6,
            }}
          >
            {answer}
          </pre>
        </div>
      )}

      {/* источники */}
      {!!sources?.length && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Источники</h3>
          <ol style={{ paddingLeft: 20 }}>
            {sources.map((s) => (
              <li key={s.n} style={{ marginBottom: 6 }}>
                <div>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.path || s.url}
                    </a>
                  ) : (
                    <span>{s.path || `[#${s.n}]`}</span>
                  )}{' '}
                  <span style={{ color: '#999' }}>· score {s.score.toFixed(3)}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* совпадения (превью) */}
      {!!matches?.length && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Совпадения (превью)</h3>
          <ul style={{ paddingLeft: 18 }}>
            {matches.map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <div>
                  <b>{m.path || m.id}</b>{' '}
                  <span style={{ color: '#999' }}>· {m.score?.toFixed?.(3)}</span>
                  {m.url ? (
                    <>
                      {' · '}
                      <a href={m.url} target="_blank" rel="noreferrer">
                        открыть
                      </a>
                    </>
                  ) : null}
                </div>
                {m.preview ? (
                  <div style={{ color: '#444', marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.preview}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* история */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>История (последние 25)</h3>
        {!history.length && <div style={{ color: '#777' }}>Пока пусто.</div>}
        {!!history.length && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>
                  {['Время', 'Маршрут', 'ns', 'Профиль', 'Q', 'ms', 'Статус', 'Действия'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '6px 8px' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td style={{ padding: '6px 8px', color: '#666' }}>
                      {new Date(h.ts).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <code>{h.route.replace('/api/rag/', '')}</code>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{h.ns}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {h.profileName}
                      {h.profileName === 'code' ? ` (${h.codeLang})` : ''}
                    </td>
                    <td style={{ padding: '6px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.query}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{h.ms ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {h.err ? (
                        <span style={{ color: '#c00' }} title={h.err}>error</span>
                      ) : (
                        <span style={{ color: '#0a0' }}>{h.res?.mode ?? 'ok'}</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <button onClick={() => loadFromHistory(h)} style={{ padding: '2px 8px' }}>
                        В форму
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
