# create-ad-cut — local developer convenience targets.
#
# Most Agentic DevOps tasks fan out to scripts/ to keep this Makefile small.

SHELL := /usr/bin/env bash
.ONESHELL:

.PHONY: help bootstrap dev backend frontend test lint rbac protect secrets clean

help:
	@echo "Targets:"
	@echo "  make bootstrap   — one-time setup (.env from azd, venv, npm install)"
	@echo "  make rbac        — grant your user the 3 data-plane roles for local dev"
	@echo "  make dev         — run backend + frontend in parallel"
	@echo "  make backend     — backend only (uvicorn, reload)"
	@echo "  make frontend    — frontend only (vite)"
	@echo "  make test        — pytest + tsc"
	@echo "  make lint        — ruff + tsc"
	@echo "  make secrets     — create SP + push GitHub Secrets/Variables"
	@echo "  make protect     — apply branch protection to main (gh CLI)"
	@echo "  make clean       — remove .venv, node_modules, .env"

bootstrap:
	@bash scripts/bootstrap-local.sh

rbac:
	@bash scripts/grant-local-rbac.sh

protect:
	@bash scripts/setup-branch-protection.sh

secrets:
	@bash scripts/setup-github-secrets.sh

backend:
	@cd backend && \
	  source .venv/bin/activate && \
	  uvicorn app.main:app --reload --port 8000

frontend:
	@cd frontend && npm run dev

dev:
	@trap 'kill 0' INT
	@$(MAKE) -j2 backend frontend

test:
	@cd backend && source .venv/bin/activate && pytest
	@cd frontend && npm run typecheck

lint:
	@cd backend && source .venv/bin/activate && ruff check .
	@cd frontend && npm run typecheck

clean:
	@rm -rf backend/.venv backend/.env frontend/node_modules frontend/dist
	@echo "✅ cleaned"
