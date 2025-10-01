/**
 * src/lib/redact.ts
 * Небольшая утилита: вычищает секреты из произвольного объекта.
 * Ключи вида apiKey/token/password/secret/authorization/... → "[redacted]".
 */
const SUSPICIOUS_KEYS = new Set([
  "apikey","api_key","apiKey","key","token","access_token","refresh_token",
  "password","pass","secret","client_secret","authorization","auth","cookie","session"
]);

export function redactSecrets<T = any>(value: T): T {
  function walk(v: any): any {
    if (v === null || v === undefined) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) {
        if (SUSPICIOUS_KEYS.has(k.toLowerCase())) {
          out[k] = "[redacted]";
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    // Доп. эвристика: очень длинные «похожие на токены» строки
    if (typeof v === "string" && v.length > 120) return "[redacted]";
    return v;
  }
  return walk(value);
}
