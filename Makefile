# ---------- Makefile (root) ----------
SHELL := /bin/bash
.ONESHELL:
.DEFAULT_GOAL := help

# Параметры по умолчанию (можно переопределять: make ingest:demo NS=foo SLOT=prod)
WEB_DIR   ?= apps/web
ENV_FILE  ?= $(WEB_DIR)/.env.local
BASE      ?= http://localhost:3000
NS        ?= rebecca/army/refs
SLOT      ?= staging
LOCAL_PDF ?= file:///mnt/c/Users/User/Desktop/Mastering\ AI\ Agents-compressed.pdf

# Шорткат: подхватить переменные из .env.local для каждого шага
define WITH_ENV
set -euo pipefail; \
if [[ -f "$(ENV_FILE)" ]]; then set -a; source "$(ENV_FILE)"; set +a; fi; \
$$@
endef

.PHONY: help
help: ## Показать список целей
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} /^[a-zA-Z0-9_:%-]+:.*##/ {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ------------------------ Миграции ------------------------

.PHONY: migrate
migrate: ## Прогнать миграции (G0 + G5)
	@$(WITH_ENV) $(WEB_DIR)/scripts/migrate.sh

# ------------------------ Диагностика ---------------------

.PHONY: diag:tables
diag:tables: ## Показать таблицы
	@$(WITH_ENV) $(WEB_DIR)/scripts/diag/list_tables.sh

.PHONY: diag:columns
diag:columns: ## Показать колонки таблицы: make diag:columns T=chunks
	@if [[ -z "$$T" ]]; then echo "Usage: make diag:columns T=<table>"; exit 1; fi
	@$(WITH_ENV) $(WEB_DIR)/scripts/diag/list_columns.sh "$$T"

.PHONY: diag:ns
diag:ns: ## Сводка по ns (по таблице chunks). Опц.: make diag:ns NS=...
	@$(WITH_ENV) psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off \
	  -v ns='$(NS)' -f $(WEB_DIR)/scripts/diag/count_ns.sql

.PHONY: diag:chunks
diag:chunks: ## Подсчет по chunks
	@$(WITH_ENV) psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off \
	  -f $(WEB_DIR)/scripts/diag/count_chunks.sql

.PHONY: diag:memories
diag:memories: ## Подсчет по memories (временный до удаления)
	@$(WITH_ENV) psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off \
	  -f $(WEB_DIR)/scripts/diag/count_memories.sql

# ------------------------ БД утилиты ----------------------

.PHONY: db:init
db:init: migrate ## Инициализация базы (миграции)

.PHONY: db:reset
db:reset: ## TRUNCATE chunks для заданных NS/SLOT + ANALYZE
	@$(WITH_ENV) psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
	  "DELETE FROM chunks WHERE ns='$(NS)' AND slot='$(SLOT)';"
	@$(WITH_ENV) psql "$$DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -c \
	  "ANALYZE chunks;"

# ------------------------ Ingest / E2E --------------------

.PHONY: ingest:demo
ingest:demo: ## Полная загрузка демо-корпуса (URL+PDF+GitHub) и ANALYZE
	@$(WITH_ENV) LOCAL_PDF="$(LOCAL_PDF)" $(WEB_DIR)/scripts/e2e/bootstrap_demo.sh

.PHONY: ingest:url
ingest:url: ## Пример: make ingest:url Q="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop"
	@if [[ -z "$$Q" ]]; then echo "Usage: make ingest:url Q=<url>"; exit 1; fi
	@$(WITH_ENV) curl -sS -X POST "$(BASE)/api/ingest/url" \
	  -H 'content-type: application/json' -H "x-admin-key: $$X_ADMIN_KEY" \
	  -d "{\"ns\":\"$(NS)\",\"slot\":\"$(SLOT)\",\"urls\":[\"$$Q\"]}" | jq

.PHONY: ingest:pdf
ingest:pdf: ## Пример: make ingest:pdf Q="file:///abs/path/file.pdf"
	@if [[ -z "$$Q" ]]; then echo "Usage: make ingest:pdf Q=<url|file://...>"; exit 1; fi
	@$(WITH_ENV) curl -sS -X POST "$(BASE)/api/ingest/pdf" \
	  -H 'content-type: application/json' -H "x-admin-key: $$X_ADMIN_KEY" \
	  -d "{\"ns\":\"$(NS)\",\"slot\":\"$(SLOT)\",\"url\":\"$$Q\"}" | jq

.PHONY: ingest:gh
ingest:gh: ## Пример: make ingest:gh OWNER=openai REPO=openai-cookbook LIMIT=10
	@if [[ -z "$$OWNER" || -z "$$REPO" ]]; then echo "Usage: make ingest:gh OWNER=<o> REPO=<r> [LIMIT=10]"; exit 1; fi
	@$(WITH_ENV) curl -sS -X POST "$(BASE)/api/ingest/github" \
	  -H 'content-type: application/json' -H "x-admin-key: $$X_ADMIN_KEY" \
	  -d "{\"ns\":\"$(NS)\",\"slot\":\"$(SLOT)\",\"owner\":\"$$OWNER\",\"repo\":\"$$REPO\",\"includeExt\":[\".md\"],\"limit\":$${LIMIT:-10}}" | jq

# ------------------------ Retrieve / Eval -----------------

.PHONY: retrieve:test
retrieve:test: ## Два sanity-запроса к /api/retrieve (basic + allow-domain)
	@$(WITH_ENV) BASE="$(BASE)" NS="$(NS)" SLOT="$(SLOT)" \
	  $(WEB_DIR)/scripts/examples/retrieve.sh

.PHONY: eval
eval: ## Запустить минимальный Golden eval, отчёт -> apps/web/docs/evals/latest.md
	@$(WITH_ENV) BASE="$(BASE)" NS="$(NS)" SLOT="$(SLOT)" \
	  npx -y tsx $(WEB_DIR)/scripts/evals/run_eval.ts | jq

# ------------------------ Локальный CI --------------------

.PHONY: ci
ci: ## Локальный CI: tsc, eslint, bash -n, контрактный тест /api/retrieve
	@echo ">> tsc --noEmit"
	@npx -y tsc --noEmit
	@echo ">> eslint"
	@npx -y eslint . --max-warnings=0
	@echo ">> bash -n"
	@bash -n $(WEB_DIR)/scripts/e2e/bootstrap_demo.sh
	@bash -n $(WEB_DIR)/scripts/diag/list_tables.sh
	@bash -n $(WEB_DIR)/scripts/diag/list_columns.sh
	@bash -n $(WEB_DIR)/scripts/migrate.sh
	@echo ">> contract smoke: /api/retrieve"
	@$(WITH_ENV) curl -sS -X POST "$(BASE)/api/retrieve" -H 'content-type: application/json' \
	  -d "{\"q\":\"ping\",\"ns\":\"$(NS)\",\"slot\":\"$(SLOT)\",\"topK\":1,\"candidateK\":1,\"minSimilarity\":0,\"nsMode\":\"strict\"}" \
	  | jq '.items!=null' | grep true >/dev/null

# ----------------------------------------------------------
