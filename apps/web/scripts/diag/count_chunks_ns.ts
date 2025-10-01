// scripts/diag/count_chunks_ns.ts
import { Pool } from "pg";

const url =
  process.env.DATABASE_URL ||
  process.env.PGURL ||
  `postgres://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`;

const pool = new Pool({ connectionString: url });

async function main() {
  const ns = process.env.NS || "rebecca/army/refs";
  const like = ns.endsWith("%") ? ns : `${ns}%`;
  const sql = `
    select ns, count(*)::int as cnt
    from chunks
    where ns like $1
    group by 1
    order by cnt desc
    limit 50
  `;
  const r = await pool.query(sql, [like]);
  console.table(r.rows);
  await pool.end();
}
main().catch(e => { console.error("DB error:", e); process.exit(1); });
