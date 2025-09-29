// scripts/diag/list_columns.ts
import { Pool } from "pg";

const url =
  process.env.DATABASE_URL ||
  process.env.PGURL ||
  `postgres://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`;

const pool = new Pool({ connectionString: url });

const CANDIDATE_TABLES = (process.env.CANDIDATE_TABLES || 'memories, memory, docs, documents, chunks, chunk, items')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

async function main() {
  const q = `
    select table_name, column_name, data_type
    from information_schema.columns
    where table_schema='public' and table_name = any($1)
    order by table_name, ordinal_position
  `;
  const r = await pool.query(q, [CANDIDATE_TABLES]);
  console.table(r.rows);
  await pool.end();
}
main().catch(e => { console.error("DB error:", e); process.exit(1); });
