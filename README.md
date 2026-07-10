# FreeLeaf

An open and free, self-hostable, collaborative LaTeX editing platform (an Overleaf alternative).

Full spec: [`Plan.md`](./Plan.md). Working conventions for contributors/agents: [`CLAUDE.md`](./CLAUDE.md).

## Status

See [`Status.md`](./Status.md) for current progress.

## Stack

Django + Django Ninja (`apps/api`) · React + Vite + TS (`apps/web`) · Node/`y-websocket` (`apps/collab`) · sandboxed TeX Live (`apps/compile`) · Postgres · MinIO · Mailpit. See `Plan.md` §4.

## Run it

Requires Docker and Docker Compose.

```sh
docker compose up
```

This starts:

| Service | URL |
|---|---|
| web (React SPA) | http://localhost:5173 |
| api (Django + Ninja) | http://localhost:8000/api/health |
| collab (Yjs sync) | ws://localhost:1234 (health: http://localhost:1234/health) |
| compile (sandboxed TeX Live runner) | http://localhost:8100/health |
| Mailpit (dev inbox for magic links) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |

A fresh clone should build and start with no extra setup.

> Always open the app at **http://localhost:5173**, not `http://127.0.0.1:5173`. Browsers treat the two as different sites, so cookies from the api (at `localhost:8000`) won't reliably carry over if you mix them — this bites hardest in Safari.

## Local development (without Docker)

**api**
```sh
cd apps/api
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

**web**
```sh
pnpm install
pnpm --filter web dev
```

## Commands

- api: `cd apps/api && python manage.py <cmd>` · test `pytest -q` · lint `ruff check .`
- web: `pnpm --filter web <script>` · lint `pnpm lint` · typecheck `pnpm typecheck`

## Security

Compilation of untrusted user LaTeX is sandboxed per `Plan.md` §7 — no shell-escape, no network, ephemeral containers, resource limits. See `docs/security.md` (added in Phase 3).

## License

[AGPL-3.0](./LICENSE).
