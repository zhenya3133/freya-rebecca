// apps/web/src/lib/hash.ts
import { createHash } from "crypto";

/** sha256 от строки в hex */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Хеш идентичности чанка + контента */
export function contentIdentityHash(input: {
  ns: string;
  slot?: string | null;
  source_id: string | null;
  chunk_no: number;
  content: string | null;
}): string {
  const payload =
    `${input.ns}|${input.slot ?? ""}|${input.source_id ?? ""}|${input.chunk_no}|${input.content ?? ""}`;
  return sha256Hex(payload);
}
