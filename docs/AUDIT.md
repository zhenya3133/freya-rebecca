# AUDIT

- Timestamp: `2025-09-28T20:22:16+03:00`
- BASE: `http://localhost:3000`  NS: `rebecca/army/refs`  SLOT: `staging`
- Env file: `/home/ser/projects/freya-rebecca/apps/web/.env.local`

## Git
- Branch: `feature/ingest-text-desktop`  Head: `44f13b42e052beec1981042f31881db7adf9f5da`
- Status:
```
?? docs/AUDIT.md
?? docs/deps.txt
?? docs/import_graph.dot
?? docs/import_graph.png
?? docs/recent_docs.tsv
?? docs/routes.txt
?? scripts/audit_everything.sh
?? scripts/audit_read_and_plan.sh
```
- Last 5:
```
44f13b4 2025-09-28 16:53:27 +0300 chore: freeze YouTube ingest (503 stub); switch Next dev off turbopack; seed+OCR pipeline; add whisper-only & desktop ingest scripts; next: folder monitor
745c6f0 2025-09-28 11:57:30 +0300 B-2 stable: auth fixed, OCR ingest working, desktop pipeline OK; remove debug endpoints
aca4718 2025-09-28 09:57:48 +0300 B-2: Desktop ingest (.doc/.docx/.pdf -> txt -> chunk 1200/120 -> seed -> backfill); auth self-check
90cfe18 2025-09-28 05:52:17 +0300 B-2: desktop .doc/.docx ingest → txt → chunk(1200/120) → /api/ingest/seed → embeddings backfill; stable source_id
7ac47ad 2025-09-27 08:53:09 +0300 ingest: add PDF+URL flow w/ unchanged detection & backfill; GitHub ingest w/ pagination, includeExt/path filters, dryRun/skipEmbeddings; helper scripts
```

## Files / API
- embed_backfill: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/admin/embed-backfill/route.ts
- github: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/ingest/github/route.ts
- retrieve: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/retrieve/route.ts
- seed: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/ingest/seed/route.ts
- url: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/ingest/url/route.ts
- youtube: **yes** — /home/ser/projects/freya-rebecca/apps/web/src/app/api/ingest/youtube/route.ts
- routes_count: 71

All route files list saved to `docs/routes.txt`.

## API Smoke
- debug_env: ```json
{"X_ADMIN_KEY": {"len": 72}, "DATABASE_URL": {"len": 65, "startsWith": "postgres://rebec"}}
```
- retrieve_ping: ```json
{"items": [{"id": "93bb7302-f8e2-4590-9748-29deee296a87", "url": "https://www.rfc-editor.org/rfc/rfc7540.txt", "title": null, "content": "ude any value it chooses and use those octets in any fashion. Receivers of a PING frame that does not include an ACK flag MUST send a PING frame with the ACK flag set in response, with an identical payload. PING responses SHOULD be given higher priority than any
```

## DB
- Tables: 2
- Docs: 0, Chunks: 6894, Embedded: 6894
- Orphan chunks: 0, Vector dims(sample): 1536

(Recent docs TSV saved to `docs/recent_docs.tsv`.)

## Imports
- Files parsed: 103, edges: 101
- DOT graph saved to `docs/import_graph.dot` (render via `dot -Tpng docs/import_graph.dot -o docs/import_graph.png`).

## Deps
- package.json snapshot saved to `docs/deps.txt`.
