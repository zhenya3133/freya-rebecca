// apps/web/scripts/migrate-g0.js
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { Pool } = require("pg");

// 1) Грузим переменные из .env.local (или .env)
(function loadEnv() {
  const candidates = [
    path.resolve(__dirname, "../.env.local"),
    path.resolve(__dirname, "../.env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      console.log(`[migrate:g0] Loaded env from ${p}`);
      return;
    }
  }
  console.warn("[migrate:g0] WARNING: .env.local/.env not found; relying on process env");
})();

// 2) Проверяем DATABASE_URL (без вывода секретов)
if (!process.env.DATABASE_URL) {
  console.error("[migrate:g0] DATABASE_URL is not set");
  process.exit(1);
}

// 3) Пул для Neon (SSL, таймауты)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 1,
});

// 4) DDL
const DDL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pgvector not created (no privileges or not needed)';
END$$;

create table if not exists corpus_registry(
  id text primary key,
  ns text not null,
  owner text,
  license text not null,
  update_cadence text,
  source_list jsonb not null,
  half_life_days int not null default 180,
  ttl_days int not null default 365,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists index_alias(
  ns text primary key,
  active_slot text not null check (active_slot in ('staging','prod')) default 'prod'
);

create table if not exists chunks(
  id uuid primary key default gen_random_uuid(),
  corpus_id text references corpus_registry(id),
  ns text not null,
  slot text not null check (slot in ('staging','prod')),
  content text not null,
  embedding vector(1536),
  source jsonb,
  content_hash text,
  created_at timestamptz default now()
);

create index if not exists idx_chunks_ns_slot on chunks(ns, slot);
create index if not exists idx_chunks_corpus on chunks(corpus_id);
create index if not exists idx_chunks_created_at on chunks(created_at);

create table if not exists initiatives(
  id uuid primary key default gen_random_uuid(),
  task text not null,
  ns text not null,
  status text not null default 'created',
  created_at timestamptz not null default now()
);

create table if not exists events(
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  at timestamptz not null default now()
);

create table if not exists artifacts(
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references initiatives(id) on delete cascade,
  type text not null,
  answer text not null,
  sources jsonb not null,
  model text not null,
  tokens jsonb not null,
  cost numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
`;

async function main() {
  const client = await pool.connect();
  try {
    console.log("[migrate:g0] Applying migration...");
    await client.query(DDL);
    console.log("[migrate:g0] Migration complete.");
  } catch (e) {
    console.error("[migrate:g0] Migration error:", e?.message || e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
