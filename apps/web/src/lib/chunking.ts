export type ChunkOpts = {
  chars?: number;   // длина чанка в символах
  overlap?: number; // перекрытие между чанками
};

export function normalizeChunkOpts(opts?: ChunkOpts) {
  const charsRaw = Number(opts?.chars);
  const chars = Number.isFinite(charsRaw) && charsRaw > 0 ? Math.floor(charsRaw) : 1200;

  const overlapRaw = Number(opts?.overlap);
  const overlapSafe =
    Number.isFinite(overlapRaw) && overlapRaw >= 0 ? Math.floor(overlapRaw) : Math.floor(chars * 0.15);

  // перекрытие не может быть ≥ длины чанка
  const overlap = Math.min(overlapSafe, chars - 1);

  // шаг всегда ≥ 1
  const step = Math.max(1, chars - overlap);

  return { chars, overlap, step };
}

export function chunkText(text: string, opts?: ChunkOpts): string[] {
  const { chars, step } = normalizeChunkOpts(opts);

  const src = (text ?? "").toString();
  if (!src.trim()) return [];

  const chunks: string[] = [];
  for (let i = 0; i < src.length; i += step) {
    chunks.push(src.slice(i, i + chars));
  }
  return chunks;
}
