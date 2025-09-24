// apps/web/src/lib/db.ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Простой ретрай для кратковременных ошибок PG.
 */
export async function withPgRetry<T>(
  fn: () => Promise<T>,
  retries = 2
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      return withPgRetry(fn, retries - 1);
    }
    throw err;
  }
}

/**
 * Выполнить запрос и вернуть массив строк (без "стреляющих" дженериков).
 */
export async function q(sql: string, params?: any[]): Promise<any[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return (res.rows ?? []) as any[];
  } finally {
    client.release();
  }
}

/**
 * Вернуть первую строку или null.
 */
export async function q1<T = any>(
  sql: string,
  params?: any[]
): Promise<T | null> {
  const rows = await q(sql, params);
  return (rows[0] as T) ?? null;
}
