---
title: Rebecca Architecture
ns: rebecca/docs
kind: rebecca/docs
tags: [architecture, overview]
owner: team-rebecca
ttl_days: 365
---

# Архитектура Rebecca

Контуры: ingest → chunks → retriever_v2 (dense + bm25 + recency + MMR) → ask/answer (профили) → memory.* (save/list/delete/promote).
