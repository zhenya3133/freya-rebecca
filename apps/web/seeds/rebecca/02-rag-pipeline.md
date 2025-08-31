---
title: RAG Pipeline
ns: rebecca/docs
kind: rebecca/docs
tags: [rag, retriever, mmr]
owner: team-rebecca
ttl_days: 365
---

# RAG-конвейер

Параметры:
- topK — сколько документов в ответ.
- minScore — отсечка финального скоринга (dense/bm25/recency).
- lambda — баланс в MMR (релевантность vs диверсификация).
- recency — распад важности по half-life.
