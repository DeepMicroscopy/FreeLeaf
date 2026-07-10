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

## Phase 1 — Identity & access: DONE

Two new Django apps in `apps/api`: `accounts` (User, MagicLink) and `projects` (Project, Membership, ShareLink) — schema per Plan.md §8. No passwords anywhere; `django.contrib.auth` stays reserved for Django admin staff logins only. Session-based app identity lives in `request.fl_user`, set by `accounts.middleware.CurrentUserMiddleware` from a `fl_user_id` session key (`core/session.py`).

**Sign-in paths (`accounts/api.py`):**
- **ORCID OAuth2** (`accounts/orcid.py`) — verified against ORCID's live API tutorial before building (2026-07-10). One deviation from Plan.md's literal wording: scope `openid` instead of `/authenticate`, per ORCID's own current guidance that they're equivalent and `/authenticate` is superseded — recorded in `docs/decisions/orcid-scope.md`. Sandbox by default (`ORCID_ENV=sandbox`). State-parameter CSRF protection on the OAuth redirect. Trusts the `orcid`/`name` fields ORCID's token endpoint returns directly (documented behavior, no extra API call).
- **Magic link** (`accounts/magic_link.py`) — signed random token (sha256-hashed at rest, raw token only ever emailed), 15 min TTL, single-use, delivered via Mailpit in dev. Email normalized to lowercase to avoid duplicate accounts.
- **Anonymous** — `POST /auth/anonymous`, optional `display_name`.

**Authorization (`projects/`):** Project/Membership/ShareLink CRUD. `projects.authz.get_authorized_project` returns 404 (not 403) for both "doesn't exist" and "no membership," so unauthorized callers can't distinguish the two. Anonymous users get access **only** by hitting `POST /share-links/{token}/join`, which creates their `User` row and `Membership` together — there's no other path to a Membership for an anonymous kind user. Share-link tokens are sha256-hashed at rest like magic-link tokens (spec names the field `token`; storing it hashed is a deliberate hardening beyond the literal spec, not a behavior change).

**CSRF/sessions:** Django's `CsrfViewMiddleware` doesn't actually protect django-ninja views (ninja marks all its views `csrf_exempt` at the Django level by design, and re-implements the check itself inside its cookie-auth classes) — found this the hard way via a failing test, not by inference. So every state-changing endpoint explicitly carries a cookie-based auth class: `SessionAuth` (requires an existing session — used for the `projects` router) or `CsrfProtect` (checks the CSRF token but doesn't require a prior session — used for anonymous/magic-link/ORCID-adjacent and share-link-join endpoints, where a session may not exist yet). `GET /auth/csrf` primes the `csrftoken` cookie for the SPA to read before its first POST.

**Rate limiting (`core/ratelimit.py`):** fixed-window counter on Django's default cache. Applied to anonymous login, magic-link request (per-email and per-IP), and share-link join. Documented limitation: LocMemCache is per-process, so this only holds under a single worker (fine for `runserver`/dev; a multi-worker prod deployment would need a shared cache backend — not in the current stack).

**CORS:** `django-cors-headers` added, since Phase 2's web app will call the API cross-port in dev. `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS`/`FRONTEND_URL` are env-driven (defaults to `http://localhost:5173`).

**Acceptance check (Plan.md §9, Phase 1):**
- 29 Django tests (`accounts`, `projects`, `health`), all passing against real Postgres, both via `manage.py test` and via `pytest` (the CI path) — covers all three sign-in paths, magic-link single-use/expiry, stranger-blocked-without-share-link, anonymous-joins-and-is-scoped-to-that-project-only, role enforcement (viewer can't rename, only owner can create/revoke share links), CSRF enforcement (rejected without token, accepted with matched cookie+header).
- Also exercised live end-to-end through `docker compose up`: anonymous login → session cookie set; magic-link request → real email landed in Mailpit → token extracted → verify → single-use confirmed (second attempt 400); project created → share link created → second browser (no prior session) joined anonymously → gained access to that project only, confirmed 401 on a fresh no-session request and 404-after-anonymous-login-without-a-link for a different project; ORCID login redirect confirmed to build the correct sandbox authorize URL with state.
- **Not verified live:** a full ORCID sandbox round-trip (authorize → user consents → callback exchanges a real code) — this environment has no registered ORCID sandbox client_id/secret. The callback code path is covered by a mocked unit test instead. If you have (or register) a sandbox app at https://sandbox.orcid.org, set `ORCID_CLIENT_ID`/`ORCID_CLIENT_SECRET` in `apps/api/.env` and I can do the real round-trip.

## Phase 2 — Files & editor co-view: DONE

**Backend (`apps/api`):** `projects.ProjectFile` model (`id, project, path, type, storage_key, size, created_at, updated_at`) — extends Plan.md §8's `type` enum with `folder` (undocumented in the original schema; ADR in `docs/decisions/project-file-folder-type.md`). Object storage via a small boto3-based S3-compatible abstraction (`core/storage.py`) against MinIO, keyed by server-generated opaque keys (`projects/{project_id}/{file_id}`) — never derived from the user-controlled path, so path traversal can't reach storage. `projects/paths.py` validates/normalizes every incoming path (reject `..`, absolute paths, disallowed characters, depth/length caps) before it ever touches the DB or storage, per the same discipline §7.7 requires for the compile sandbox. `projects/files_api.py` adds the tree API: list, create file, create folder, get/update content, rename (cascades folder renames to all descendant paths in one transaction), delete (cascades folder deletes), and a multipart image/asset upload. Route registration order matters here — Django's URL resolver matches path templates in declaration order and ninja doesn't type-prefix path converters, so `/files/upload` had to be registered before `/files/{file_id}` or a POST to `/upload` would 405 (matched the wrong pattern with `file_id="upload"`). Every write endpoint requires `owner`/`editor` role; `viewer` is read-only. Project creation now auto-seeds `main.tex` with a minimal LaTeX skeleton.

**Typed client (`packages/shared`):** added `openapi-typescript` + `openapi-fetch`. `pnpm generate` pulls the live schema from `/api/openapi.json` and regenerates `src/generated.ts` (committed, like any generated-client setup — regenerate whenever the API schema changes). `src/client.ts` wraps it in a singleton `api` client with a CSRF middleware (echoes the `csrftoken` cookie as `X-CSRFToken` on unsafe methods) and `ensureCsrfCookie()`/`apiOrigin()` helpers. Per CLAUDE.md, no hand-written request/response types anywhere in the frontend — everything types through the generated `paths`/`components` schema.

**Frontend (`apps/web`):** new deps — `react-router-dom`, CodeMirror 6 (`@codemirror/state|view|commands|language|legacy-modes`, using the `legacy-modes` stex mode for LaTeX highlighting rather than a bespoke Lezer grammar), `lucide-react` for icons. Hand-rolled design system (no CSS framework): `styles/theme.css` defines the full token set (leaf-green accent ramp, light/dark via `prefers-color-scheme` + `data-theme` override) and `components/ui/` holds Button/TextField/Spinner/EmptyState/Toast primitives, used consistently across every screen. Routes: `/login` (ORCID button, magic-link form with a "check your inbox" state, anonymous entry with optional display name), `/auth/magic-link` (token callback), `/projects` (list + create), `/projects/:id/{editor,library,settings}` (workspace shell — back link, project name, tab nav, sidebar file tree, main content). `LibraryTab`/`SettingsTab` are intentionally inert placeholders naming the phase that fills them in (6 and 7).

The file tree (`components/workspace/FileTree.tsx`) supports create file/folder (root or nested via a hover-revealed "+" per folder), inline rename, delete (with confirm), and upload via toolbar button or drag-and-drop onto the tree — all through the typed client, including the multipart upload (openapi-fetch's typed multipart support via an explicit `bodySerializer`, not a hand-rolled `fetch`). The editor pane (`CodeMirrorEditor.tsx`) loads file content via a plain `fetch` (the content endpoint returns a raw `HttpResponse` with no OpenAPI-described body, so the typed client can't help there), autosaves 1.5s after the last keystroke plus an explicit Cmd/Ctrl+S binding, and shows a Saved/Saving/Unsaved/Error status pill. `SplitPane.tsx` is a hand-rolled resizable divider (pointer events, arrow-key accessible, ratio persisted to `localStorage` per project) rather than a new dependency, splitting the CodeMirror pane from a PDF-preview placeholder (real compilation is Phase 3/4).

**Two real bugs found and fixed during live verification** (both silent — zero console errors, zero failed network requests, blank UI):
1. `components/workspace/fileTree.ts` (a plain tree-building helper) and `FileTree.tsx` (the React component) differ only by case. On this machine's case-insensitive filesystem, Vite's extensionless-import resolver nondeterministically resolved `./FileTree` to the wrong file, throwing `SyntaxError: Importing binding name 'FileTree' is not found` — caught by the user testing manually in Safari, not by the automated console-error listener. Fixed by renaming the helper to `treeUtils.ts`. Recorded in memory (`project_web_gotchas`) since it'll recur if a future phase repeats the pattern.
2. The workspace tabs used relative `<NavLink to="editor">` next to a nested `<Routes>` matching the same wildcard — React Router resolved each click relative to the *currently active* nested route, so clicking "Library" from `/editor` navigated to `/editor/library` (stacking) instead of `/library`, silently rendering nothing (no matching nested `<Route>`, no error). Fixed with absolute paths built from `projectId`.

**Acceptance check (Plan.md §9, Phase 2) — verified live**, via a Playwright driver (no `chromium-cli` in this environment; wrote a throwaway driver script per the `run` skill's fallback guidance — worth generating a project skill with `/run-skill-generator` if this becomes a recurring need):
- Signed in via magic link (anonymous users correctly get 403 on project creation — that's Phase 1's by-design restriction, not a bug); created project "Test Paper"; `main.tex` auto-appeared in the tree and auto-selected in the editor.
- Typed into CodeMirror → "Saved" pill appeared after the debounce → **reloaded the page → edit persisted** (the core acceptance requirement).
- Dragged the split divider → pane widths changed and persisted the new ratio.
- Created a folder ("figures") and uploaded an image via the toolbar button → both appeared in the tree with correct icons, correctly sorted (folders before files, alphabetical); clicking the image rendered it in the preview pane (confirms cookies flow correctly cross-port in this same-site dev setup — noted as a topology assumption that would need revisiting for a genuinely cross-site production deployment).
- Library and Settings tabs render their placeholder states cleanly.
- Zero console errors and zero failed/4xx/5xx requests across the entire flow after the two fixes above.
- Full backend regression: 38 Django tests still passing.

## Post-Phase-2 fixes (user-reported): DONE

Two issues reported after manual Safari testing, both fixed and confirmed working:

**1. CORS failure on `http://127.0.0.1:5173`.** Browsers treat `localhost` and `127.0.0.1` as different origins (and different *sites* — one's a domain, one's a bare IP). `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` only allowed `localhost:5173`, so a page loaded via `127.0.0.1:5173` got hard-blocked calling the api. Fixed: both defaulted in `apps/api/config/settings.py`, `docker-compose.yml`, `.env.example`. Added a README callout to consistently use `localhost` anyway, since even with CORS fixed, cookies set by the api won't reliably bridge the two hostnames (bites hardest in Safari's stricter cross-site cookie handling).

**2. Anonymous access redesigned to be invitation-only**, per explicit correction: "Anonymous is just by invitation (share link), if a project shall be created, it should be non-anonymous." The backend already enforced this (anonymous users get 403 creating projects), but the frontend exposed "Contribute anonymously" as a generic standalone button on `/login` with no project context — a dead end (empty project list, can't create). Changes:
- Removed the anonymous option from `LoginPage`; it now only offers ORCID + magic link.
- Added `/join/:token` (`JoinPage.tsx`): if already signed in (any kind), auto-joins via the share-link token and redirects into the project. If not signed in, offers ORCID, magic link, **or** "Continue as guest" with an optional display name — anonymous account creation now only happens in this share-link context, matching the corrected design.
- Added a `next` redirect param end-to-end (`accounts/magic_link.py`, `accounts/api.py`'s `orcid_login`/`orcid_callback`/`magic_link_request`) so ORCID/magic-link sign-in from the join page returns the user to `/join/:token` afterward instead of dropping them at `/projects`. Open-redirect protection on both ends: `core/urlsafety.py` (backend) and `lib/urlsafety.ts` (frontend, defense in depth) — `next` must be a same-origin relative path.
- Added a `ShareButton` in the workspace header (owner-only, matching the backend's existing owner-only restriction on share-link creation) so the join flow is actually reachable from the UI — generates an editor-role link, shown with a copy button in a small popover.
- Regenerated the typed OpenAPI client (`packages/shared/src/generated.ts`) for the new `next` fields.

Django check + all 38 backend tests pass; user confirmed the fix works in-browser.

## Production deployment: DONE

User asked for a production-ready `docker-compose.prod.yml` and had already sketched a strong draft (localhost-only debug ports, separate `Dockerfile.prod` per service, TLS port reserved) — built on it rather than replacing it. Filled in what was missing and fixed what was broken:

- **`apps/web/nginx.conf`** (new) — the missing piece the draft referenced but didn't have. Single public-facing `web` container serves the built SPA and reverse-proxies `/api`, `/admin`, `/static`, `/collab` to their services by Docker Compose network name, making production entirely same-origin (sidesteps the CORS/cross-site-cookie fragility dev's split origins have — see the fix above). `proxy_pass` targets use `set $upstream ...` + a `resolver 127.0.0.11 valid=10s` pointed at Docker's embedded DNS rather than bare hostnames — found via testing that nginx resolves bare-hostname `proxy_pass` targets once at config-load time, so it fails to start entirely if `api`/`collab` aren't up yet (a real problem for fresh-stack boots and rolling restarts).
- **`apps/api/config/settings.py`** — wired up what the user's own edits (whitenoise... actually just `django-anymail[mailgun]` in requirements.txt, `STATIC_ROOT`) were pointing at but hadn't connected: `whitenoise` for serving collected static (Django admin's CSS/JS) straight from gunicorn, conditionally in `MIDDLEWARE` only when `DEBUG=False` (unconditionally, it warned on every dev request since `collectstatic` never runs there); `django-anymail`/Mailgun as the `EMAIL_BACKEND` when `MAILGUN_API_KEY` is set, falling back to dev's Mailpit SMTP otherwise; `SESSION_COOKIE_SECURE`/`CSRF_COOKIE_SECURE` gated on `DEBUG`, `SECURE_PROXY_SSL_HEADER` unconditionally (trusts nginx's `X-Forwarded-Proto`).
- **Fixed real bugs in the user's compose draft**: the api `command:` gunicorn invocation pointed at `freeleaf.wsgi:application` (doesn't exist — the actual module is `config.wsgi:application`, silently correct in `Dockerfile.prod`'s own `CMD` but the compose-level override had the typo and would have crashed on deploy); no top-level `name:`, so running prod from the same checkout as dev shares the default directory-derived project name — **confirmed by testing**: prod recreated dev's live `postgres`/`minio` containers in place. Added `name: freeleaf-prod`.
- **`.env.prod.example`** (new) — every value required, no insecure defaults, documents that `FRONTEND_URL`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` should all be the one public domain (same-origin via nginx).
- Ports: per user request, `web` publishes `8001` and `api`'s debug-only port is `8002` in this repo's example (chosen so dev and prod can run side by side without clashing; map to `80`/`443` for a real deployment). Dropped host-port publishing entirely for `minio`/`collab`/`compile` — nothing external needs them, and it removes any collision risk with dev's `9000`/`1234`/`8100`.
- Added a "Production deployment" section to `README.md`.

**Verified live**: built both `Dockerfile.prod` images; `nginx -t` passes; booted the full prod stack in isolation (`freeleaf-prod` project, fake-but-structurally-valid secrets) — migrations ran, 136 static files collected via whitenoise, gunicorn started with 3 workers, and end-to-end through nginx: `/` → 200, `/api/health` → 200 `{"status": "ok"}`, `/admin/login/` → 200. Direct-to-api debug port correctly 400s on a mismatched Host header (`DJANGO_ALLOWED_HOSTS` enforcement working). Confirmed dev stack's containers/volumes were untouched throughout. Test stack torn down after.

## Phase 3 — Compilation service (sandboxed, dual compiler): DONE

Implements Plan.md §7 in full. This is the security-critical core of the project, so every control was verified against real behavior, not assumed — including one piece of research (latexmk's actual flag semantics) fetched from primary docs before writing any code, per CLAUDE.md's rule for exactly this situation.

**`docker/texlive/`** (new) — the ephemeral sandbox worker image: Debian slim + `texlive-latex-base/-recommended/-extra`, `texlive-fonts-recommended`, `texlive-xetex`, `latexmk` (not `texlive-full`, which is ~5-7GB and unnecessary). Runs as non-root `texuser`. Built and tested — real image, not aspirational.

**`apps/compile`** rewritten from the Phase 0 health stub into the actual orchestrator (`sandbox.py` + `main.py`). Verified against latexmk's real documentation before implementing, because memory was unreliable here and getting it wrong would silently leave shell-escape enabled: **latexmk has no native `-no-shell-escape` flag** — it must be baked directly into the `$pdflatex`/`$xelatex` command-override variable (`-e '$pdflatex=q/pdflatex -no-shell-escape .../'`), which is what `sandbox.py` does. Every §7 control is implemented and independently verified live (see below): no shell-escape, `--network none`, fresh container per job via the Docker Engine API (`cap_drop=["ALL"]`, `pids_limit`, `mem_limit`, `nano_cpus`, `read_only=True`, non-root `user=`, `no-new-privileges`), a wall-clock timeout enforced by `compile` itself (kills + removes the container on expiry, doesn't just abandon it), and a second independent path-safety check (`_safe_extract`) on top of the validation `projects/paths.py` already does, since untrusted-tar-becomes-filesystem-write is its own well-known vulnerability class (CVE-2007-4559-style) regardless of what already validated the logical paths upstream.

**Two real bugs found via testing, both fixed:**
1. **Docker-in-Docker sibling-container path bug.** `apps/compile` talks to the *host's* Docker daemon over the mounted socket to spawn job containers. `tempfile.mkdtemp()` was creating paths inside `compile`'s own private container filesystem — invisible to the host daemon, which resolves bind-mount sources against the *host* filesystem. Every job container therefore mounted an empty directory and reported "Could not find file 'main.tex'" despite the file genuinely existing on the `compile` side. Fixed by bind-mounting one real host directory (`./.compile-jobs`, via `${PWD}`) into `compile` at a fixed path, with `sandbox.py` writing job files there (visible to itself) while telling the *host* daemon the matching host-side path when specifying the sibling container's mounts. Documented in `sandbox.py` directly since it's exactly the kind of thing that's cheap to reintroduce.
2. My own first shell-escape test assertion was too weak to actually prove anything (an `or`-chain that was nearly always true). Replaced with real evidence: the compile log shows the exact `pdflatex -no-shell-escape ...` invocation and zero `runsystem` trace — TeX's documented behavior when shell-escape is disabled is to treat `\write18` as an inert `\write`, which is exactly what happened (compile succeeded normally, no command executed, no trace).

**`apps/api`**: new `ProjectSettings` (compiler, main_doc_path, central_bib_path — lazily created with defaults, matching Plan.md §8's schema which Phase 2 deliberately deferred) and `CompileRun` models. `projects/compile_api.py`: `GET`/`PATCH /projects/:id/settings`, `POST /projects/:id/compile` (materializes the project's current files from MinIO into an in-memory tar, dispatches to `compile`, stores the returned PDF/log/synctex back to MinIO, records a `CompileRun`), `GET /projects/:id/compile-runs[/​:id/pdf|/log]`. Owner/editor only for writes, matching the established role pattern; 404 (not 403) for non-members, matching the existing authorization convention.

**Verified live** (full chain, not mocked) via a throwaway Python client against the real running stack:
- Valid document compiles successfully under **both** pdflatex and xelatex, producing a real `%PDF`-signed file.
- `\write18{touch /tmp/PWNED}` does not execute (see above).
- Path traversal in the project tar (`../../etc/pwned.tex`) is rejected with 400 before any extraction happens.
- An infinite-loop document is killed at the 60s wall-clock timeout — confirmed `status: "timeout"`, `duration_ms: ~60300`, and **zero leftover containers or job directories** afterward (cleanup runs correctly even on the timeout path).
- A malformed document fails cleanly (`status: "failed"`, no PDF).
- Through the full `apps/api` layer: created a project, edited `main.tex`, compiled (default `pdflatex`), fetched the resulting PDF back through the API, **switched the project's compiler setting to `xelatex`, recompiled, and confirmed the engine actually changed** (Plan.md's literal Phase 3 acceptance wording) — not just that the setting persisted.
- 13 new fast Django tests (mocking only the `compile` HTTP call, since the real sandboxed-compile path was already proven above and doesn't belong in the routine test suite) — authorization, settings persistence/validation, `CompileRun` bookkeeping, PDF/log retrieval, 404 on no-PDF. Full suite: **51/51 passing**, both `manage.py test` and the `pytest` CI path.

**Docs**: `docs/security.md` (new) — the full threat model and control table. `docs/decisions/compile-sandbox.md` (new) — ADR for the Docker-in-Docker choice and the one deliberate exception to the non-root convention (`compile` itself runs as root to reach the Docker socket; the job containers it spawns are the real, fully-locked-down security boundary).

**Known gaps, flagged rather than silently deferred:**
- `apps/compile` running as root with host-socket access is a real, accepted risk for *this* orchestrator process (documented in the ADR) — Plan.md's named production hardening path (gVisor/Firecracker/nsjail instead of Docker-in-Docker) isn't implemented. Fine for a single-tenant self-host; revisit before a genuinely hostile multi-tenant deployment.
- No compile-specific rate limiting yet (a project member could trigger many concurrent compiles; each is resource-capped individually but N of them isn't bounded). Noted in `docs/security.md`.
- CI doesn't build the TeX Live image or exercise the sandboxed-compile path (would need Docker-in-Docker in the Actions runner and a multi-hundred-MB image build) — the real sandbox behavior was verified manually this session instead; CI only runs the mocked-fast API tests. Worth revisiting if compile logic churns enough to need automated regression coverage of the sandbox itself.
- The compiled PDF isn't wired into the frontend yet — that's explicitly Phase 4 ("Co-view compile loop": PDF.js rendering, Recompile button, parsed error panel).

## ORCID login 400 on user's production deployment (`freeleaf-api.deepmicroscopy.org`): RESOLVED

Root cause, found via the new logging (see below) within one round trip: `DisallowedHost` — the user's deployment routes the web app and the api to two *different* hostnames via their own reverse proxy (`freeleaf.deepmicroscopy.org` for the SPA, `freeleaf-api.deepmicroscopy.org` straight to the api), bypassing `apps/web/nginx.conf`'s same-origin proxying entirely. `DJANGO_ALLOWED_HOSTS` didn't include the api's own host, so Django rejected the request outright — not the session/cookie issue the vague original 400 suggested.

This is a valid, real-world deployment topology this repo's docs didn't cover — `.env.prod.example` and `docker-compose.prod.yml` only documented the same-origin-via-nginx setup, implicitly assuming `DJANGO_ALLOWED_HOSTS`/`FRONTEND_URL`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` are always the same one value. Fixed the docs, not just answered the user once:
- **`.env.prod.example`** now documents both topologies explicitly side by side: (A) same-origin via nginx — all four values identical; (B) split subdomains — `DJANGO_ALLOWED_HOSTS`/`ORCID_REDIRECT_URI` take the **api's** host, `FRONTEND_URL`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` take the **web app's** host (they're no longer the same value once the SPA's fetch() calls are genuinely cross-origin).
- **README**'s production section links to that and flags the specific failure signature (400 with nothing useful in the browser → check `docker compose -f docker-compose.prod.yml logs api` for `DisallowedHost` first).

The error-message-splitting and `LOGGING` config added while diagnosing (see previous revision of this entry) stay — they're generally useful, not just for this one bug, and are what actually surfaced the real cause in one round trip instead of several rounds of guessing.

**Separate follow-up while deploying:** `VITE_API_ORIGIN` (what the web app's JS uses to reach the api — needed for the split-subdomain topology above) was hardcoded to empty string in `docker-compose.prod.yml`'s build args, not configurable at all. Made it read from the env file (`${VITE_API_ORIGIN:-}`) and documented in `.env.prod.example` alongside the other topology-B values, with a note that it's a Vite **build-time** arg — changing it needs `--build`, a plain restart won't pick up a new value.

## Magic-link sign-in restricted to invited context only: DONE

User: "disable magic link for signup, this would allow spam... only for initial signup — if invited to a project, magic links are fine." Correct: `POST /auth/magic-link/request` had no gate beyond per-email/per-IP rate limits, so anyone could make the instance email arbitrary addresses at a slow-but-nonzero rate. Fixed at the layer that actually matters (backend), not just the UI:

- **`MagicLinkRequestIn.share_link_token`** (new, required field) — the request now requires a real, unexpired `ShareLink` token; without one it's rejected before any email is sent (403 for invalid/expired, 422 for missing entirely — Pydantic's own required-field validation). Tokens are `secrets.token_urlsafe(32)`, unguessable, and only ever handed out by a project owner via the Share button — this closes the "spam any address" vector down to "already holds a live invite to some project," which the owner can revoke.
- **`LoginPage.tsx`** — the generic `/login` page no longer offers email sign-in at all, only ORCID (plus a footnote pointing at invite links for email/anonymous access). `JoinPage.tsx` (the `/join/:token` route) keeps its email option, now passing the token through as the new required field.
- Consolidated three near-identical `hash_token()`/`_hash_token()` copies (magic-link's, share-link's, and the one this change would have added as a third) into `core/tokens.py`.
- Added `core/testing.login_as(client, user)` — logs a test client in directly via the session, bypassing auth endpoints. Necessary, not just convenient: nearly every test file's "get a logged-in owner" helper was built on magic-link (the previously-easiest non-anonymous login path), which no longer works standalone now that it requires an existing project+share-link — a chicken-and-egg problem for bootstrapping the *first* user in a test. Updated all four test files accordingly.
- New tests: missing token (422), invalid token (403), expired token (403), plus the existing magic-link test suite updated to set up a real inviter+project+share-link fixture. Full suite: **54/54 passing**.
- **Verified live**, not just in tests: confirmed `/login` renders with no email field (screenshot), a raw API call with no token is rejected, and the full `/join/:token` → email → real Mailpit email (with the correct `next` redirect param) → verify → land directly in the invited project's workspace chain still works end to end. (One bug found and fixed along the way — in my *test script*, not the app: it reconstructed the magic-link URL from just the extracted `token=` value instead of using the full emailed URL, silently dropping `next` and landing on `/projects` instead of the workspace. Worth remembering next time a test extracts a token from an email instead of using the full link.)

## Split-subdomain deployment: "CSRF token missing" creating projects — RESOLVED

Follow-up to the `DisallowedHost` fix above: once ORCID login worked (session cookie confirmed round-tripping correctly in the logs), `POST /api/projects` still failed with Django's `Forbidden (CSRF token missing.)`. Root cause: `CSRF_COOKIE_DOMAIN` defaults to host-only, so the csrftoken cookie set by the api's own host was invisible to `document.cookie` on the *web app's* different host — the frontend's CSRF middleware (`packages/shared/src/client.ts`) had nothing to echo back as `X-CSRFToken`. The session cookie didn't have this problem (subdomains are same-site, so the browser resends it automatically regardless of what JS can read) — only the CSRF double-submit pattern needs JS to actually read the cookie value, which is where host-only scoping bit.

Fix: new `CSRF_COOKIE_DOMAIN` setting (`config/settings.py`, `docker-compose.prod.yml`), set to the parent domain shared by both hosts (with a leading dot) — e.g. `.freeleaf.deepmicroscopy.org` for the user's actual `freeleaf.deepmicroscopy.org` / `api.freeleaf.deepmicroscopy.org` split. `.env.prod.example`'s topology-B section rewritten to use a sub-subdomain example (`api.freeleaf.example.com`) instead of a sibling one, since that's what the user ended up deploying and it makes the `CSRF_COOKIE_DOMAIN` value obviously-correct by construction. Attempted a local repro via fake `/etc/hosts` subdomains before the user settled on their final domain shape; abandoned that in favor of just shipping the fix once the topology was confirmed. **User confirmed working in production.**

## Next: Phase 4 — Co-view compile loop

PDF.js in the Editor tab's PDF pane (currently a placeholder), a "Recompile" action with debounced auto-compile on save, and a log/error panel that parses the raw compile log Phase 3 already returns into readable warnings/errors with file+line.
