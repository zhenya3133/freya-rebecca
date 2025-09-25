// apps/web/src/lib/auth.ts
import { ENV } from "./env";

export function requireAdminKey(getHeader: (name: string) => string | null) {
  const key = getHeader("x-admin-key");
  if (!ENV.X_ADMIN_KEY || key !== ENV.X_ADMIN_KEY) {
    const err: any = new Error("Unauthorized: x-admin-key required");
    err.status = 401;
    throw err;
  }
}

export function requireIngestEnabled(channel: string) {
  if (!ENV.INGEST_ENABLED) {
    const err: any = new Error("Ingest disabled by feature flag");
    err.status = 403;
    throw err;
  }
  if (!ENV.INGEST_CHANNELS.includes(channel)) {
    const err: any = new Error(`Ingest channel not allowed: ${channel}`);
    err.status = 403;
    throw err;
  }
}
