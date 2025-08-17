// apps/web/src/lib/chunk.ts

export type ChunkOptions = {
  size?: number;      // длина чанка в символах
  overlap?: number;   // перекрытие между чанками
};

/**
 * Простое разбиение текста по символам с overlap.
 * Дефолтно size=1500, overlap=200. Значения "поджаты" к безопасным диапазонам.
 */
export function splitIntoChunks(text: string, opts: ChunkOptions = {}): string[] {
  const rawSize = Math.floor(opts.size ?? 1500);
  const rawOverlap = Math.floor(opts.overlap ?? 200);

  const size = Math.max(1, Math.min(10_000, rawSize));
  const overlap = Math.max(0, Math.min(size - 1, rawOverlap));

  // Нормализуем переносы, чтобы не плодить «ломаные» границы
  const clean = (text ?? "").replace(/\r\n/g, "\n");

  const chunks: string[] = [];
  if (!clean) return chunks;

  const step = size - overlap;
  for (let i = 0; i < clean.length; i += step) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}
