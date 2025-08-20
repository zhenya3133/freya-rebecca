// apps/web/src/lib/hash.ts
import { createHash } from "crypto";

/** sha256 от строки в hex */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
