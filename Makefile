# AIpbx — developer & ops shortcuts
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Create .env from template if missing
	@test -f .env || (cp .env.example .env && echo "Created .env — edit secrets before 'make up'")

up: env ## Build & start the full stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

restart: ## Restart all services
	docker compose restart

logs: ## Tail all logs
	docker compose logs -f --tail=100

ps: ## Show running services
	docker compose ps

db-shell: ## Open a psql shell
	docker compose exec postgres psql -U $${POSTGRES_USER:-aipbx} -d $${POSTGRES_DB:-aipbx}

migrate: ## (Re)apply DB schema
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-aipbx} -d $${POSTGRES_DB:-aipbx} < db/schema.sql

seed: ## Seed default admin & demo data
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-aipbx} -d $${POSTGRES_DB:-aipbx} < deploy/scripts/seed.sql

create-admin: ## Create/reset a superadmin (usage: make create-admin EMAIL=you@co.com PASSWORD=secret)
	docker compose exec -T api node dist/scripts/create-admin.js "$${EMAIL:?set EMAIL=...}" "$${PASSWORD:?set PASSWORD=...}"

realtime: ## (Re)apply the Asterisk PJSIP realtime schema
	docker compose exec -T postgres psql -U $${POSTGRES_USER:-aipbx} -d $${POSTGRES_DB:-aipbx} < db/asterisk_realtime.sql

asterisk-cli: ## Open Asterisk CLI
	docker compose exec asterisk asterisk -rvvv

api-logs: ## Tail API logs
	docker compose logs -f api

ai-logs: ## Tail AI engine logs
	docker compose logs -f ai-engine

test: ## Run service test suites
	cd services/api && npm test || true
	cd services/ai-engine && python -m pytest || true

deploy: ## Provision DigitalOcean infra (terraform)
	cd deploy/terraform && terraform init && terraform apply

clean: ## Remove containers + volumes (DESTRUCTIVE)
	docker compose down -v

.PHONY: help env up down restart logs ps db-shell migrate seed asterisk-cli api-logs ai-logs test deploy clean
