// apps/web/src/lib/db.ts
import { Pool } from "pg";

// чтобы reuse'ить пул меж хот-рефрешами
declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // для Neon / SSL
    ssl: { rejectUnauthorized: false },
    // повышение живучести коннекта
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    max: 5,
  });

if (!global.__pgPool) {
  global.__pgPool = pool;
}

/**
 * Простейший retry для транзиентных сетевых/коннект-ошибок.
 * По умолчанию даём 2 повторные попытки.
 */
export async function withPgRetry<T>(
  fn: () => Promise<T>,
  retries = 2
): Promise<T> {
  let last: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const msg = String(e?.message ?? e);
      const transient =
        /terminated unexpectedly|reset by peer|ECONNRESET|timeout|Connection closed/i.test(
          msg
        );
      if (transient && i < retries) {
        await new Promise((r) => setTimeout(r, 300 + i * 400));
        continue;
      }
      throw e;
    }
  }
  throw last;
}
