// apps/web/src/lib/pg.ts
import { Pool } from "pg";

const connStr = process.env.DATABASE_URL;
if (!connStr) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({ connectionString: connStr });

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
  const res = await pool.query(text, values);
  return res.rows;
}

// На всякий случай пригодится тип
export type SQL = typeof sql;
