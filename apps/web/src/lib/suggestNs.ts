// apps/web/src/lib/suggestNs.ts

import { NAMESPACES, NamespaceDef, filterAllowed } from "./namespaces";
import { getEmbedding } from "./embeddings";
import { cosineSimilarity } from "./similarity";

type SuggestInput = {
  title?: string;
  description?: string;
  mediaType?: string; // "github" | "pdf" | "video" | "text" ...
  tags?: string[];
  allow?: string[];   // если хотим ограничить выбор набором ключей ns
};

export type SuggestResult = {
  ns: string;
  score: number; // 0..1
  ranking: Array<{ key: string; score: number }>;
  threshold: number;
  decided: boolean; // >= threshold ?
};

type Cache = { ready: boolean; keys: string[]; embeds: number[][] };
const nsEmbedCache: Cache = { ready: false, keys: [], embeds: [] };

function nsToText(n: NamespaceDef): string {
  const ex = (n.examples ?? []).join("\n- ");
  const aliases = (n.aliases ?? []).join(", ");
  return [
    n.title,
    n.description,
    aliases ? `Aliases: ${aliases}` : "",
    ex ? `Examples:\n- ${ex}` : "",
  ].filter(Boolean).join("\n");
}

async function ensureNsEmbeddings(): Promise<void> {
  if (nsEmbedCache.ready) return;
  const texts = NAMESPACES.map(nsToText);
  const embeds = [];
  for (const t of texts) {
    embeds.push(await getEmbedding(t));
  }
  nsEmbedCache.keys = NAMESPACES.map(n => n.key);
  nsEmbedCache.embeds = embeds;
  nsEmbedCache.ready = true;
}

// Главная функция: возвращает лучший ns и рейтинг.
export async function suggestNamespace(input: SuggestInput): Promise<SuggestResult> {
  await ensureNsEmbeddings();
  const allowList = filterAllowed(input.allow, NAMESPACES);

  const payload = [
    input.title ?? "",
    input.description ?? "",
    input.mediaType ? `Media: ${input.mediaType}` : "",
    (input.tags ?? []).map(t => `#${t}`).join(" "),
  ].filter(Boolean).join("\n");

  const q = await getEmbedding(payload || "generic agent architecture material");

  // считаем косинус с каждым ns
  const scored = nsEmbedCache.embeds.map((e, i) => ({
    key: nsEmbedCache.keys[i],
    score: cosineSimilarity(q, e),
  }));

  // фильтруем по allow при необходимости
  const allowedKeys = new Set(allowList.map(a => a.key));
  const filtered = scored.filter(s => allowedKeys.size === 0 || allowedKeys.has(s.key));

  filtered.sort((a, b) => b.score - a.score);

  // Порог уверенности: эмпирически 0.78 — хороший «auto-route».
  const threshold = 0.78;
  let ns = (filtered[0]?.key) ?? "sandbox";
  const decided = (filtered[0]?.score ?? 0) >= threshold;

  // если не уверены — отправляем в sandbox
  if (!decided) ns = "sandbox";

  return {
    ns,
    score: filtered[0]?.score ?? 0,
    ranking: filtered.slice(0, 5),
    threshold,
    decided,
  };
}
