// apps/web/src/lib/domain_filter.ts
import type { DomainFilter } from "./retrieval-contract";

export function matchesDomain(url: string, f?: DomainFilter): boolean {
  if (!f) return true;
  const allow = f.allow ?? [];
  const deny  = f.deny  ?? [];

  // deny сильнее allow
  for (const d of deny) {
    if (!d) continue;
    if (url.includes(d)) return false;
  }
  if (allow.length === 0) return true;
  for (const a of allow) {
    if (!a) continue;
    if (url.includes(a)) return true;
  }
  return false;
}
