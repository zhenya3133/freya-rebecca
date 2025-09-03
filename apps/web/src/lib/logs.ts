// apps/web/src/lib/logs.ts
import { randomUUID } from "crypto";

export type LogKind = string;

export type LogItem = {
  id: string;
  kind: LogKind;
  ns?: string;
  profile?: string;
  params?: any;
  request?: any;
  response?: any;
  created_at: string; // ISO
};

const CAP = Math.max(50, Number(process.env.LOG_CAP ?? 500));
const ring: LogItem[] = [];

/** Безопасно записывает лог; ошибки глотает, чтобы не ломать основной поток */
export async function writeLogSafe(entry: Omit<LogItem, "id" | "created_at">) {
  try {
    const item: LogItem = {
      ...entry,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    ring.push(item);
    if (ring.length > CAP) ring.splice(0, ring.length - CAP);
  } catch (e) {
    console.warn("[logs] write failed:", e);
  }
}

/** Возвращает логи (по убыванию времени) с простыми фильтрами */
export async function listLogs(opts?: {
  limit?: number;
  kind?: string;
  kindPrefix?: string;
  ns?: string;
  profile?: string;
}) {
  const { limit = 50, kind, kindPrefix, ns, profile } = opts ?? {};
  let items = ring.slice().reverse();
  if (kind) items = items.filter((x) => x.kind === kind);
  if (kindPrefix) items = items.filter((x) => x.kind.startsWith(kindPrefix));
  if (ns) items = items.filter((x) => x.ns === ns);
  if (profile) items = items.filter((x) => x.profile === profile);
  return { items: items.slice(0, limit), count: items.length };
}
