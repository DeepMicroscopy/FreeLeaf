# FreeLeaf

An open and free, self-hostable, collaborative LaTeX editing platform.
Self-host it on your own infrastructure for full digital sovereignty over your documents and data — no third-party cloud, no account with someone else's ToS standing between you and your own research.

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

## Production deployment

```sh
cp .env.prod.example .env.prod
# fill in .env.prod: real secrets, your domain, Mailgun, ORCID production app
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

This builds production images (gunicorn + collected/whitenoise-served static for the api, an nginx-served Vite build for the web) and runs a single public-facing `web` container that reverse-proxies `/api`, `/admin`, `/static`, and `/collab` to the internal services — everything is same-origin in production, which avoids the CORS/cross-site-cookie fragility dev's separate `:5173`/`:8000` origins have. Only `web` is meant to be internet-facing; terminate TLS in front of it (a managed load balancer, or your own Caddy/nginx with certs proxying to `web`'s port) — `apps/web/nginx.conf` only serves plain HTTP.

`docker-compose.prod.yml` uses `name: freeleaf-prod` so it never shares containers/volumes with a dev stack running from the same checkout; its example port (`8001`) is chosen so both can run side by side during testing — map to `80`/`443` for a real deployment.

**Running the web app and api on separate subdomains instead** (your own reverse proxy, not `apps/web/nginx.conf`) works too, but `DJANGO_ALLOWED_HOSTS`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` stop being the same value — see the comment block at the top of `.env.prod.example` for exactly which one needs which host. Getting `DJANGO_ALLOWED_HOSTS` wrong here surfaces as a 400 with nothing useful in the browser; check `docker compose -f docker-compose.prod.yml logs api` for `DisallowedHost` first.

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

## Promo video

`python3 scripts/make_promo_video.py` renders a silent, screenshot-driven promo video (for
sharing on LinkedIn, etc.) from the screenshots in `docs/assets/img` — crossfaded scenes with
animated on-screen text and a soft procedural music bed (no narration, no bundled audio).
Requires only `ffmpeg`. `--dry-run` prints the scene plan without rendering.

## Security

Compilation of untrusted user LaTeX is sandboxed per `Plan.md` §7 — no shell-escape, no network, ephemeral containers, resource limits. See `docs/security.md` (added in Phase 3).

## License

[AGPL-3.0](./LICENSE).
