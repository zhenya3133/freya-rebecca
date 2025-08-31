-- apps/web/migrations/2025-08-27_rag_logs.sql
create table if not exists rag_logs (
  id                  uuid primary key,
  created_at          timestamptz not null default now(),
  ns                  text not null,
  slot                text not null check (slot in ('staging','prod')),
  model               text,
  profile             text,
  query               text not null,
  topk                int,
  lambda              double precision,
  minscore            double precision,
  maxtokens           int,
  ok                  boolean,
  error               text,
  latency_ms          int,
  answer              text,
  payload             jsonb,
  payload_parse_error text,
  sources             jsonb,
  matches             jsonb
);

create index if not exists rag_logs_ns_slot_created_idx on rag_logs (ns, slot, created_at desc);
create index if not exists rag_logs_created_idx         on rag_logs (created_at desc);
create index if not exists rag_logs_ok_idx              on rag_logs (ok);
create index if not exists rag_logs_profile_idx         on rag_logs (profile);
