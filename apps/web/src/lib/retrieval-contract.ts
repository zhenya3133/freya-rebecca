// RC-v1: единый контракт для /api/retrieve и retriever_v2

export type Slot = "staging" | "prod";
export type NsMode = "strict" | "prefix";

export type DomainFilter = {
  allow?: string[];
  deny?: string[];
};

export type RetrieveRequest = {
  q: string;
  ns: string;
  slot: Slot;

  // Опциональные настройки с дефолтами
  topK?: number;            // по умолчанию 5
  candidateK?: number;      // по умолчанию max(topK, 200)
  minSimilarity?: number;   // по умолчанию 0
  nsMode?: NsMode;          // "prefix" | "strict" (по умолчанию "prefix")
  domainFilter?: DomainFilter; // можно опустить
};

export type RetrieveItem = {
  id: string;
  ns: string;
  slot: Slot;
  url: string | null;
  title: string | null;
  snippet: string | null;
  publishedAt: string | null;
  sourceType: string | null;
  kind: string | null;
  metadata: Record<string, any>;
  score: number;
};

export type RetrieveResponse = {
  items: RetrieveItem[];
  filterInfo?: {
    nsMode: NsMode;
    candidateK: number;
    minSimilarity: number;
    droppedAfterSimilarity: number;
    droppedAfterDomain: number;
    domainAllow: string[];
    domainDeny: string[];
  };
  debugVersion: "rc-v1";
};

// ---- utils

export function clamp(n: number | undefined, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, x));
}

// упрощённый доменный фильтр на клиентской стороне
export function matchesDomain(
  url: string | null,
  df?: DomainFilter
): boolean {
  if (!df || (!df.allow?.length && !df.deny?.length)) return true;
  if (!url) return false;

  let host = "";
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }

  const isMatch = (dom: string) =>
    host === dom.toLowerCase() || host.endsWith("." + dom.toLowerCase());

  if (df.allow?.length) {
    if (!df.allow.some(isMatch)) return false;
  }
  if (df.deny?.length) {
    if (df.deny.some(isMatch)) return false;
  }
  return true;
}
