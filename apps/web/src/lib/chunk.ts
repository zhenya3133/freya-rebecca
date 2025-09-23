// apps/web/src/lib/chunk.ts

export type ChunkOptions = {
  /** Максимальная длина чанка в символах (после нормализации). */
  size?: number;
  /** Перекрытие между последовательными чанками в символах. */
  overlap?: number;

  /** Минимальная длина «разумного» чанка при упаковке абзацев. */
  minSize?: number;
  /** Сохранять ли немного пустых строк между логическими кусками (читабельность). */
  keepSoftBreaks?: boolean;
};

/** Безопасные дефолты. */
const DEFAULTS = {
  size: 1500,
  overlap: 200,
  minSize: 400,
  keepSoftBreaks: false,
} as const;

/**
 * Главная функция разбиения текста на чанки.
 * Алгоритм:
 *  1) Нормализует переносы строк и пробелы.
 *  2) Выделяет Markdown-блоки кода ```…``` и оставшийся текст.
 *  3) Ненадкодовые части режет по заголовкам/параграфам.
 *  4) Пакует всё в чанки нужного размера; слишком крупные куски
 *     дорезает посимвольно с overlap.
 */
export function splitIntoChunks(raw: string, opts: ChunkOptions = {}): string[] {
  const size = clampInt(opts.size ?? DEFAULTS.size, 1, 50_000);
  const overlap = clampInt(opts.overlap ?? DEFAULTS.overlap, 0, Math.max(0, size - 1));
  const minSize = clampInt(opts.minSize ?? DEFAULTS.minSize, 1, size);
  const keepSoftBreaks = !!opts.keepSoftBreaks;

  const text = normalizeText(raw);
  if (!text) return [];

  // 1) Размечаем блоки кода ```...``` как единицы, между ними — обычный текст.
  const units = splitByCodeFences(text);

  // 2) Обычный текст дробим по заголовкам/параграфам.
  const logicalPieces: string[] = [];
  for (const u of units) {
    if (u.kind === "code") {
      logicalPieces.push(u.text);
    } else {
      const sections = splitByHeadings(u.text)
        .flatMap(splitByParagraphs)
        .map((s) => s.trim())
        .filter(Boolean);
      logicalPieces.push(...sections);
    }
  }

  // 3) Упаковка в чанки заданного размера. Крупные куски дорезаем посимвольно.
  const packed: string[] = [];
  let buffer = "";

  const flush = () => {
    const b = buffer.trim();
    if (b) packed.push(b);
    buffer = "";
  };

  for (const piece of logicalPieces) {
    const p = keepSoftBreaks ? ensureSoftBreaks(piece) : piece;

    // Если «логический» кусок уже больше лимита — дорезаем посимвольно.
    if (p.length > size) {
      // Сначала выталкиваем буфер, чтобы не перемешивать.
      flush();
      packed.push(...splitByChars(p, size, overlap));
      continue;
    }

    // Если текущий буфер + кусок помещается — просто добавляем с переносом строки.
    if ((buffer ? buffer.length + 1 : 0) + p.length <= size) {
      buffer = buffer ? buffer + "\n" + p : p;
      continue;
    }

    // Иначе — буфер на выход, начинаем новый.
    // Стремимся не оставлять слишком маленькие чанки (если можно слить).
    if (buffer && buffer.length < minSize) {
      if (buffer.length + 1 + p.length <= size) {
        buffer = buffer + "\n" + p;
        continue;
      }
    }
    flush();
    buffer = p; // p гарантированно <= size
  }
  flush();

  // 4) Добавляем перекрытие между чанками (хвост предыдущего + текущий).
  if (overlap > 0 && packed.length > 1) {
    const withOverlap: string[] = [];
    for (let i = 0; i < packed.length; i++) {
      const current = packed[i];
      if (i === 0) {
        withOverlap.push(current);
      } else {
        const prevTail = packed[i - 1].slice(-overlap);
        const candidate = (prevTail + "\n" + current).trim();
        if (candidate.length <= size) {
          withOverlap.push(candidate);
        } else {
          // подрезаем текущий настолько, чтобы вместилось
          const room = Math.max(0, size - (prevTail.length + 1));
          const truncated = current.slice(0, room);
          withOverlap.push((prevTail + "\n" + truncated).trim());
        }
      }
    }
    return withOverlap.map((s) => s.trim()).filter(Boolean);
  }

  return packed.map((s) => s.trim()).filter(Boolean);
}

/**
 * Обёртка для совместимости с остальным кодом проекта.
 * Используй `chunkText(raw, options)` — под капотом вызывает `splitIntoChunks`.
 */
export function chunkText(raw: string, opts?: ChunkOptions): string[] {
  return splitIntoChunks(raw, opts);
}

/* ------------------------ Вспомогательные утилиты ------------------------ */

/** Нормализация переносов строк и пробелов. */
export function normalizeText(input: string): string {
  if (!input) return "";
  let s = String(input);

  // Переводы строк -> \n
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Убираем хвостовые пробелы
  s = s.replace(/[ \t]+\n/g, "\n");

  // Сжимаем очень длинные серии пустых строк до двух
  s = s.replace(/\n{3,}/g, "\n\n");

  // Удаляем невидимые спецсимволы управления (кроме \n и \t)
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  return s.trim();
}

/** Разбивает на последовательность { kind: "code" | "text", text }. */
function splitByCodeFences(
  text: string
): Array<{ kind: "code" | "text"; text: string }> {
  const re = /```[\s\S]*?```/g;
  const result: Array<{ kind: "code" | "text"; text: string }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = re.lastIndex;
    const before = text.slice(lastIndex, start).trim();
    if (before) result.push({ kind: "text", text: before });
    result.push({ kind: "code", text: text.slice(start, end).trim() });
    lastIndex = end;
  }
  const tail = text.slice(lastIndex).trim();
  if (tail) result.push({ kind: "text", text: tail });
  return result.length ? result : [{ kind: "text", text }];
}

/** Режем по Markdown-заголовкам (#, ##, ### …). */
function splitByHeadings(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push(t);
    buf = [];
  };

  for (const line of lines) {
    if (/^\s{0,3}#{1,6}\s+/.test(line) && buf.length) {
      flush();
    }
    buf.push(line);
  }
  flush();
  return out;
}

/** Режем по «двойному переносу» — абзацы. */
function splitByParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Посимвольное резание с overlap (fallback для очень длинных кусков). */
function splitByChars(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  const step = Math.max(1, size - Math.min(size - 1, overlap)); // = size - overlap
  for (let i = 0; i < text.length; i += step) {
    const part = text.slice(i, i + size).trim();
    if (part) chunks.push(part);
    if (i + size >= text.length) break;
  }
  return chunks;
}

/** Чуть улучшает читабельность: гарантирует один пустой разделитель между логическими кусками. */
function ensureSoftBreaks(s: string): string {
  // Если внутри уже есть пустые строки — ничего не делаем
  if (/\n{2,}/.test(s)) return s.trim();
  return s.replace(/\n/g, "\n").trim();
}

/** Безопасное ограничение целых чисел. */
function clampInt(n: number, min: number, max: number): number {
  const x = Math.floor(Number.isFinite(n) ? n : min);
  return Math.max(min, Math.min(max, x));
}
