## Checklist

- [ ] Contract retrieval RC v1 не менялся
  - [ ] Если менялся: обновлены docs/contract, миграции, примеры
- [ ] Ingest upsert (chunks) зелёный, идемпотентность сохранена
- [ ] Eval прошёл локально: `npx tsx apps/web/scripts/evals/run_eval.ts` → hit@5 > 0
- [ ] Диаг-скрипты выполняются: list_tables/list_columns/count_ns/count_chunks
- [ ] CI зелёный: typecheck, eslint, bash -n, (и integration если DATABASE_URL задан)
- [ ] .env.local не закоммичен, env.example актуален

## Notes
Коротко, что поменяли и почему.
