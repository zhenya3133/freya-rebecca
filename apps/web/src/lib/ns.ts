// apps/web/src/lib/ns.ts
export const NS = [
  "freya/strategy","freya/kpi","freya/governance",
  "rebecca/core","rebecca/patterns","rebecca/ingest","rebecca/rag",
  "ingest/github","ingest/pdfs","ingest/videos",
  "market/by","market/ru","sales/playbooks","legal/compliance",
  "agents/floki","agents/elijah",
] as const;

export type Namespace = typeof NS[number];

export function assertNamespace(ns: string): asserts ns is Namespace {
  if (!(NS as readonly string[]).includes(ns)) {
    throw new Error(`Invalid namespace: ${ns}`);
  }
}
