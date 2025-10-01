// apps/web/src/lib/pg.ts
import { Pool } from "pg";

// Lazy initialization to avoid build-time initialization errors
let _realPool: Pool | null = null;

/**
 * Get the actual Pool instance (not the Proxy).
 * Use this when you need Pool methods that don't work well with Proxy (e.g., .connect()).
 */
export function getPool(): Pool {
  if (!_realPool) {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error("DATABASE_URL is not set. Please configure it in .env.local");
    }
    _realPool = new Pool({ connectionString: connStr });
  }
  return _realPool;
}

// Export a Proxy that looks like Pool but lazily initializes
// Type it explicitly as Pool to support generics like pool.query<T>()
export const pool: Pool = new Proxy({} as Pool, {
  get(target, prop) {
    const actualPool = getPool();
    const value = (actualPool as any)[prop];
    // If it's a method, bind it to the actual pool instance
    if (typeof value === 'function') {
      return value.bind(actualPool);
    }
    return value;
  }
});

/**
 * Примитивный tagged-template, похожий на postgres.js `sql``:
 *   const rows = await sql`select * from memories where id = ${id}`;
 * Он подставит $1,$2,… и вернёт rows.
 */
export async function sql(
  strings: TemplateStringsArray,
  ...values: any[]
): Promise<any[]> {
  // Собираем текст с плейсхолдерами $1..$n
  let text = "";
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  const res = await getPool().query(text, values);
  return res.rows;
}

// На всякий случай пригодится тип
export type SQL = typeof sql;
