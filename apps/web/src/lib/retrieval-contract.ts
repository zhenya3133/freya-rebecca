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
  snippet: string | null;
  score: number;            // итоговый (после пересчётов)
  similarity: number;       // сырая косинусная близость
  published_at: string | null;
  source_type: string | null;
  kind: string | null;
};

export type RetrieveResponse = {
  items: RetrieveItem[];
  debugVersion: "rc-v1";
};
