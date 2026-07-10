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

## Post-Phase-2 fixes (user-reported, IN PROGRESS)

Two issues reported after manual Safari testing:

**1. CORS failure on `http://127.0.0.1:5173`.** Browsers treat `localhost` and `127.0.0.1` as different origins (and different *sites* — one's a domain, one's a bare IP). `CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` only allowed `localhost:5173`, so a page loaded via `127.0.0.1:5173` got hard-blocked calling the api. Fixed: both defaulted in `apps/api/config/settings.py`, `docker-compose.yml`, `.env.example`. Added a README callout to consistently use `localhost` anyway, since even with CORS fixed, cookies set by the api won't reliably bridge the two hostnames (bites hardest in Safari's stricter cross-site cookie handling) — **done, not yet re-verified live** (was mid-verification when this got cut off for token budget).

**2. Anonymous access redesigned to be invitation-only**, per explicit correction: "Anonymous is just by invitation (share link), if a project shall be created, it should be non-anonymous." The backend already enforced this (anonymous users get 403 creating projects), but the frontend exposed "Contribute anonymously" as a generic standalone button on `/login` with no project context — a dead end (empty project list, can't create). Changes:
- Removed the anonymous option from `LoginPage`; it now only offers ORCID + magic link.
- Added `/join/:token` (`JoinPage.tsx`): if already signed in (any kind), auto-joins via the share-link token and redirects into the project. If not signed in, offers ORCID, magic link, **or** "Continue as guest" with an optional display name — anonymous account creation now only happens in this share-link context, matching the corrected design.
- Added a `next` redirect param end-to-end (`accounts/magic_link.py`, `accounts/api.py`'s `orcid_login`/`orcid_callback`/`magic_link_request`) so ORCID/magic-link sign-in from the join page returns the user to `/join/:token` afterward instead of dropping them at `/projects`. Open-redirect protection on both ends: `core/urlsafety.py` (backend) and `lib/urlsafety.ts` (frontend, defense in depth) — `next` must be a same-origin relative path.
- Added a `ShareButton` in the workspace header (owner-only, matching the backend's existing owner-only restriction on share-link creation) so the join flow is actually reachable from the UI — generates an editor-role link, shown with a copy button in a small popover.
- Regenerated the typed OpenAPI client (`packages/shared/src/generated.ts`) for the new `next` fields.

**Verification status:** Django check passes, all 38 backend tests still pass post-change, typed client regenerated cleanly. Was mid-way through a live Playwright pass (owner creates project → generates share link → fresh browser context joins as guest via the link → confirms guest is scoped to only that project, confirms guest doesn't see the Share button) when this session paused for token budget — **not yet confirmed working end-to-end in the browser**. Next session: finish that verification run, fix anything it surfaces, then continue to Phase 3.

## Next: Phase 3 — Compilation service (sandboxed, dual compiler)

Implement §7's sandboxed pdflatex/xelatex runner in `apps/compile` (currently a health-only stub): `POST /projects/:id/compile`, no shell-escape, `--network none`, ephemeral per-job containers, resource/timeout limits, structured log parsing. This is explicitly called out as the single most important technical constraint in the project — will not relax the sandbox for convenience.
