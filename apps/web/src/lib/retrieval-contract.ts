// apps/web/src/lib/retrieval-contract.ts
export type Slot = "staging" | "prod";

export type RecencyOptions = {
  alpha?: number;   // экзп. затухание, 0..1
  beta?: number;    // бонус свежести, 0..1
  halfLifeDays?: number; // полураспад
};

export type DomainFilter = {
  allow?: string[];  // белый список: подстроки/доменные куски
  deny?: string[];   // чёрный список
};

export type RetrieveRequest = {
  ns: string;
  slot: Slot;
  q: string;                // текст запроса
  topK?: number;
  candidateK?: number;
  minSimilarity?: number;
  nsMode?: "strict" | "prefix";
  recency?: RecencyOptions;
  domainFilter?: DomainFilter; // можно опустить
  debugVersion?: "rc-v1";
};

export type RetrieveItem = {
  id: string;
  url: string | null;
  title: string | null;
  content: string | null;
  score: number;
};

export type RetrieveResponse = {
  items: RetrieveItem[];
  filterInfo: { allowMatched: number; denySkipped: number };
  debugVersion: "rc-v1";
};
