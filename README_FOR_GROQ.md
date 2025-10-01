# Freya ↔ Rebecca — quick start

## What this is
RAG-система: ingestion (URL/PDF/GitHub/Seed/Desktop+OCR) → Postgres+pgvector → /api/retrieve → (далее Strict RAG answers).

## How to run (local)
1) Install deps:
   pnpm install
2) Start Postgres (Docker):
   docker run --name freya-pg -e POSTGRES_USER=freya -e POSTGRES_PASSWORD=freya -e POSTGRES_DB=freya -p 5432:5432 -d postgres:15-alpine
3) Env:
   copy `apps/web/.env.local.example` → `apps/web/.env.local` and set `X_ADMIN_KEY`.
4) Migrations:
   bash scripts/migrate.sh
5) Run Next:
   pnpm --workspace apps/web run dev
6) Health:
   curl http://localhost:3000/api/db-ping
