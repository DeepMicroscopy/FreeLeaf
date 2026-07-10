# FreeLeaf — Status

## Phase 0 — Scaffold & infra: DONE

Repo initialized (git). Monorepo scaffolded per Plan.md §10:

- `apps/web` — React + Vite + TS (default template trimmed to a placeholder landing page). Scripts: `dev`, `build`, `lint` (oxlint), `typecheck`.
- `apps/api` — Django 5.1 + Django Ninja. `config` project, `health` app exposing `GET /api/health`. Postgres via env vars (`POSTGRES_*`), settings read `DJANGO_SECRET_KEY`/`DJANGO_DEBUG`/`DJANGO_ALLOWED_HOSTS` from env. `requirements.txt` / `requirements-dev.txt`, ruff config, pytest-django config, one real test (`health/tests.py`).
- `apps/collab` — Node 20 + TS, `ws`-based HTTP+WebSocket server, `GET /health`. Yjs sync (`y-websocket`) is a Phase 5 addition per the ADR below — kept out of deps for now.
- `apps/compile` — Python stdlib-only HTTP stub, `GET /health`. Real sandboxed pdflatex/xelatex runner (§7) is Phase 3.
- `packages/shared` — placeholder for the generated OpenAPI TS client (populated once `api` has real endpoints to generate from).
- `pnpm-workspace.yaml` covers `apps/web`, `apps/collab`, `packages/shared` (Python services aren't part of the pnpm workspace).

**Infra:**
- `docker-compose.yml` — `postgres`, `minio`, `mailpit`, `api`, `collab`, `compile`, `web`, each with health checks / exposed health paths.
- Each service has its own `Dockerfile` (+ `.dockerignore`); `web`'s build context is the repo root so it can see `packages/shared` via the pnpm workspace.
- `.github/workflows/ci.yml` — `web` job (pnpm install --frozen-lockfile, lint, typecheck) and `api` job (Postgres service container, ruff, pytest).
- `LICENSE` — AGPL-3.0 (canonical text). `README.md` — run steps for Docker and local dev. `docs/decisions/collab.md` — ADR recording the Node `y-websocket` default from §6.

**Acceptance check (Plan.md §9, Phase 0) — verified locally:**

```
docker compose up -d --build
```
All 7 containers reached `Up`/`healthy`. Health probes:

| Service | Check | Result |
|---|---|---|
| api | `GET http://localhost:8000/api/health` | 200 |
| collab | `GET http://localhost:1234/health` | 200 |
| compile | `GET http://localhost:8100/health` | 200 |
| web | `GET http://localhost:5173/` | 200 |
| mailpit | `GET http://localhost:8025/` | 200 |
| minio | `GET http://localhost:9000/minio/health/live` | 200 |
| postgres | `pg_isready` healthcheck | healthy |

`api` migrations ran cleanly on container start; `python manage.py test health` passed against the real Postgres container. Stack torn down after verification (`docker compose down`) — nothing left running.

One environment note, not project-specific: this machine's `pnpm` was shadowed by a broken Corepack shim (signature-key verification failure against the npm registry). Worked around with `corepack disable && npm install -g pnpm@9.15.0`; Docker builds install pnpm the same way rather than via `corepack enable`, so this doesn't affect the containers.

## Next: Phase 1 — Identity & access

ORCID OAuth2, magic-link email auth, anonymous contribution, sessions/CSRF/rate-limiting, Projects CRUD + ShareLink, authorization middleware. Per CLAUDE.md: will verify current ORCID OAuth2 endpoints/scopes against live docs before implementing.
