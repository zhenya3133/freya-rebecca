// scripts/diag/top_ns.ts
import { Pool } from "pg";

const url =
  process.env.DATABASE_URL ||
  process.env.PGURL ||
  `postgres://${process.env.PGUSER || "postgres"}:${process.env.PGPASSWORD || ""}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "postgres"}`;

const pool = new Pool({ connectionString: url });

async function main() {
  const limit = Number(process.env.LIMIT || 20);

  const q1 = `
    select 'memories' as tbl, ns, count(*)::int as cnt
    from memories group by 2 order by cnt desc limit $1
  `;
  const q2 = `
    select 'chunks' as tbl, ns, count(*)::int as cnt
    from chunks group by 2 order by cnt desc limit $1
  `;
  const [m, c] = await Promise.all([pool.query(q1, [limit]), pool.query(q2, [limit])]);

  console.log("\n=== Top ns in memories ===");
  console.table(m.rows);
  console.log("\n=== Top ns in chunks ===");
  console.table(c.rows);

  await pool.end();
}
main().catch(e => { console.error("DB error:", e); process.exit(1); });
