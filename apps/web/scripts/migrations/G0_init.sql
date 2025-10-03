-- Схема и расширения (идемпотентно)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.chunks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ns            text NOT NULL,
  slot          text NOT NULL CHECK (slot IN ('staging','prod')),
  content       text NOT NULL,
  embedding     vector(1536) NOT NULL,
  url           text,
  title         text,
  snippet       text,
  published_at  timestamptz,
  source_type   text,
  kind          text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash  text NOT NULL,
  source_id     text,
  chunk_no      integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
