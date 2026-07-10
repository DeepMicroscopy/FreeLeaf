# Build Plan / Claude Code Prompt — "FreeLeaf"

> An open and free, self-hostable, collaborative LaTeX editing platform (an Overleaf alternative).
> Project name: **FreeLeaf**.

---

---

## 1. Goal & north star

Build a web application where a user can:

1. Create a project of LaTeX source files, images, and a bibliography.
2. Edit `.tex` in a browser editor with a **co-view**: source on one side, compiled PDF on the other.
3. Compile the project server-side (safely) and see the PDF update.
4. Collaborate in real time — including **without an account**.
5. Manage references (BibTeX) in a dedicated tab, with `\cite{}` autocomplete and smart paste/drop.
6. Self-host the whole thing with a single `docker compose up`.

The north star is the Overleaf core loop — *edit → compile → co-view PDF* — plus real-time collaboration and frictionless, academic-friendly access (ORCID / magic link / anonymous). Ship that well before extras.

---

## 2. Feature list (authoritative)

- **Co-view** of the LaTeX source file and the PDF output, side by side.
- **Real-time collaboration** — multiple people editing the same document simultaneously. With options to track changes and provide comments, resolve comments and answer to comments. 
- **Versioning** - Use git for versioning. Auto-commit whenever compilation is triggered (cmd+s), or after 5 minutes of a use being inactive (server-side check) with pending changes.
- **Security-first compilation.** LaTeX can execute arbitrary code (`\write18` / shell-escape). Treat **all user LaTeX as untrusted**. Compilation **MUST** be sandboxed (see §7). *This is the single most important technical constraint in the project.*
- **Reproducible.** Everything runs via Docker Compose. Fresh clone → `docker compose up` → working app.
- **Authentication:**
  - **ORCID-based** (OAuth2) sign-in.
  - **Magic-link** (passwordless email) sign-in.
  - **Anonymous contribution** — no account required; the user is *asked* for a display name but may skip it.
- **Project settings** — choose the central `.bib` file and the PDF compiler.
- **Dual sandboxed compilers** — **pdflatex** and **xelatex**; the user chooses per project.
- **Literature management (BibTeX)** in a **separate tab**. Typing `\cite{` opens a list of cite keys.
- **Context-dependent copy/paste** — if pasted (clipboard) or dropped (drag-and-drop) content is BibTeX, add it to the library instead of pasting it raw.

---

## 3. Non-negotiable principles

- **Open & free.** No proprietary cloud dependencies. License: **AGPL-3.0** (network service; matches Overleaf CE). State the choice in `LICENSE`.
- **Security first for compilation.** See §7. Never weaken the sandbox for convenience.
- **Type-safe where possible.** TypeScript on the frontend; typed API contract (OpenAPI) between frontend and the Python backend.
- **Reproducible.** Everything via Docker Compose; a clean clone must build and start.
- **Incremental & tested.** Every phase has acceptance criteria and tests before it's "done."

---

## 4. Tech stack (use these unless there's a strong reason not to)

| Concern | Choice | Rationale |
|---|---|---|
| API backend | **Django + Django Ninja** (Python) | Batteries-included auth/ORM/migrations/admin; Ninja gives Pydantic schemas + auto OpenAPI |
| Typed client | OpenAPI → generated TS client | Recover cross-language type safety from Ninja's schema |
| Frontend | React + Vite + TypeScript | Standard, fast |
| Editor | **CodeMirror 6** | Lightweight, extensible, good LaTeX support, integrates with Yjs, supports the autocomplete + paste/drop hooks we need |
| PDF preview | **PDF.js** | In-browser PDF rendering |
| Real-time collab | **Yjs** (CRDT) | Proven CRDT, offline-tolerant, presence/multi-cursor |
| Collab transport | **See §6 — documented fork** (Node `y-websocket` default; Django Channels + `pycrdt` alternative) | Yjs's reference ecosystem is Node; keep it a deliberate, isolated decision |
| DB | **PostgreSQL** | Relational metadata |
| Migrations/ORM | Django ORM | Comes with Django |
| Object storage | Local FS (dev) behind an **S3-compatible** abstraction; **MinIO** for self-host | Assets + PDFs |
| Email (magic link) | SMTP; **Mailpit** in dev | Local inbox for testing |
| OAuth | **ORCID** OAuth2 (`/authenticate` scope) | Academic identity |
| LaTeX engines | **TeX Live** with **pdflatex + xelatex** (+ common fonts) | Both compilers in one sandbox image |
| Sandbox | Ephemeral container per compile (see §7) | Isolation |
| BibTeX parsing | JS parser in browser (e.g. a maintained bibtex parser lib) + `bibtexparser` (Python) server-side for validation/normalization | Detect/parse on paste; validate on save |
| Monorepo | pnpm workspaces (frontend/collab) + a Python service dir | One repo |
| Containers | Docker + Docker Compose | Reproducible self-host |

If you deviate from any of these, add a one-paragraph ADR in `docs/decisions/`.

---


**Services:** `web` (React SPA) · `api` (Django + Ninja: auth, projects, files, settings, library, triggers compiles) · `collab` (Yjs sync) · `compile` (sandboxed TeX Live runner) · infra: `postgres`, `minio`, `mailpit`.

Keep `compile` **stateless and isolatable**. Keep `collab` isolated behind an interface (§6).

---

## 6. Collaboration transport — documented fork

Yjs is JS-native. Choose one, record it in `docs/decisions/collab.md`:

- **Default — Node `collab` service:** a small Node process running `y-websocket`, persisting Yjs state periodically to storage/Postgres. Well-trodden, best ecosystem support. Adds Node to the stack for exactly one service.
- **All-Python alternative:** Django **Channels** for the WebSocket transport + **`pycrdt`** (Rust-backed Yjs bindings) for shared docs. Keeps the backend single-language; smaller community — **verify `pycrdt` maintenance status before committing** and budget extra time.

Default to the Node service unless single-language is a hard requirement. Either way, `.tex` and the central `.bib` are Yjs documents so concurrent edits merge.

---

## 7. Compilation sandbox — READ CAREFULLY

User LaTeX is untrusted code. Both compilers must run under these rules:

1. **No shell-escape.** Run with `-no-shell-escape` for **both** pdflatex and xelatex. Never enable `\write18`. (Consequence: shell-escape-dependent packages like `minted`/`svg` are unsupported for now; document this. Any future allowlist is a separate, reviewed feature.)
2. **No network.** Compile container runs `--network none`.
3. **Ephemeral & isolated.** Fresh container (or `nsjail`/`firejail`) per job. Mount only the job's temp dir. Read-only root FS where possible; writable scratch/output dir only.
4. **Resource limits.** Hard CPU + memory (e.g. 1 CPU / 1–2 GB), a **wall-clock timeout** (e.g. 60 s → kill + timeout error), and an output size cap.
5. **Non-root** user inside the container.
6. **Drop capabilities** (`--cap-drop ALL`), set `--pids-limit`, no privileged mode.
7. **Sanitize paths** — reject `..`, absolute paths, and symlinks escaping the project root.
8. **Compiler selection** comes from project settings (`pdflatex` | `xelatex`); default `pdflatex`. Drive via `latexmk` (`-pdf` vs `-xelatex`). Include common fonts in the image so xelatex/fontspec works.
9. Return structured output `{ status, pdf, log, synctex, durationMs, compiler }`; parse the LaTeX log into structured errors/warnings for the UI.

Make the sandbox mechanism swappable (Docker-in-Docker for dev; gVisor/Firecracker/nsjail possible in prod). Document the threat model in `docs/security.md`.

---

## 8. Data model (initial)

```
User        { id, kind('orcid'|'email'|'anonymous'), orcidId?, email?,
              displayName?, createdAt }
MagicLink   { id, email, tokenHash, expiresAt, usedAt? }
Project     { id, ownerId?, name, createdAt, updatedAt }     // ownerId nullable (anon-created)
ProjectSettings { projectId, mainDocPath, centralBibPath?, compiler('pdflatex'|'xelatex') }
Membership  { id, projectId, userId, role('owner'|'editor'|'viewer') }
ShareLink   { id, projectId, token, role, expiresAt?, createdAt }  // how anon/invited users join
ProjectFile { id, projectId, path, type('tex'|'bib'|'image'|'other'),
              storageKey, updatedAt }
Doc         { id, projectId, path, yjsStateKey }             // collaborative .tex and .bib
CompileRun  { id, projectId, compiler, status, startedAt, finishedAt,
              pdfKey, logKey, synctexKey, exitCode }
```

Anonymous users get a lightweight `User` row (`kind='anonymous'`, optional `displayName`) created when they join via a `ShareLink`. Registered users are `kind='orcid'` or `kind='email'`.

---

## 9. Phased build plan (execute in order)

### Phase 0 — Scaffold & infra
- Monorepo: `apps/web`, `apps/api` (Django+Ninja), `apps/collab` (per §6), `apps/compile`, plus `docker/`.
- `docker-compose.yml`: postgres, minio, mailpit, and all services (stubbed OK).
- Health endpoints per service; root `README` with run steps; ESLint/Prettier + Ruff/Black; a CI workflow (build + lint + typecheck).
- **Acceptance:** `docker compose up` starts everything; each `/health` → 200; CI passes.

### Phase 1 — Identity & access
- **ORCID OAuth2** (`/authenticate` scope; use ORCID **sandbox** in dev; client id/secret via env). On callback, upsert `User(kind='orcid')` with ORCID iD + name. *Verify endpoints against current ORCID docs.*
- **Magic link:** enter email → server emails a signed, single-use, short-expiry link (Mailpit in dev) → clicking logs in / upserts `User(kind='email')`.
- **Anonymous:** "Contribute anonymously" → create `User(kind='anonymous')`; prompt for display name with a **Skip** option.
- Sessions (httpOnly cookies), CSRF protection, rate-limiting on magic-link + anonymous creation.
- Projects CRUD; `ShareLink` creation; authorization middleware that correctly gates registered vs anonymous access (anonymous users reach a project **only** via a valid share link).
- **Acceptance (tested):** each of the three sign-in paths works; an anonymous user can join a project via share link and is blocked from projects they lack a link for; magic links are single-use and expire; ORCID flow round-trips against the sandbox.

### Phase 2 — Files & editor co-view
- Left sidebar file tree (create/rename/delete files & folders; upload images).
- Top-level tabs: **Editor** · **Library** · **Settings**.
- **Editor tab = co-view:** CodeMirror 6 (LaTeX highlighting) on one side, a PDF pane on the other, resizable splitter. Open a `.tex`, edit, save (non-collaborative for now).
- **Acceptance:** create a project with `main.tex`, edit and persist across reload; resize the split; upload an image and see it in the tree.

### Phase 3 — Compilation service (sandboxed, dual compiler)
- Implement §7. `POST /projects/:id/compile` → materialize tree → run sandboxed TeX Live with the project's compiler → store PDF + parsed log + SyncTeX.
- Support **pdflatex** and **xelatex**; default `pdflatex`.
- **Acceptance (tests for each):** a valid doc compiles under both compilers; `\write18{...}` does **not** execute; a slow/infinite doc times out cleanly; path-traversal is rejected; switching the compiler setting changes the engine used.

### Phase 4 — Co-view compile loop
- PDF.js in the Editor tab's PDF pane. "Recompile" + debounced auto-compile on save.
- Log/error panel: parsed warnings/errors with file + line.
- **Acceptance:** edit → compile → PDF updates in place; a LaTeX error shows a readable message in the panel, not a raw dump.

### Phase 5 — Real-time collaboration
- Integrate Yjs (§6): `.tex` (and later `.bib`) become shared docs. Multi-cursor + presence showing display names — including anonymous users' chosen/placeholder names. Periodically persist Yjs state; materialize latest content at compile time.
- **Acceptance:** two browsers editing one file see each other's edits and cursors live; a compile reflects merged state; reconnect after a drop converges without data loss; an anonymous participant appears in presence.

### Phase 6 — Literature management (BibTeX)
- **Library tab:** parse the project's central `.bib` into a table of entries (key, type, title, author, year); add/edit/delete entries; the central `.bib` is a Yjs doc so edits merge.
- **`\cite{}` autocomplete:** in the editor, typing inside `\cite{`, `\citep{`, `\citet{`, `\parencite{`, `\autocite{`, `\textcite{`, etc. opens a completion list of cite keys (with title/author as detail); support comma-separated multiple keys.
- **Context-dependent paste/drop:** intercept `paste` and `drop` in the editor and Library tab. If the content (clipboard text or a dropped `.bib`/text file) is detected + parsed as BibTeX, **do not paste it raw** — append the entries to the central library, dedupe by cite key (warn on conflicts), and show a "Added N references" toast. Non-BibTeX content pastes/drops normally.
- **Acceptance:** typing `\cite{` lists keys from the library and inserts a chosen key; pasting a BibTeX entry anywhere in the editor adds it to the library instead of inserting text; dropping a `.bib` file imports its entries; duplicate keys are flagged, not silently overwritten; pasting ordinary text still pastes normally.

### Phase 7 — Project settings & polish
- **Settings tab:** select the **central `.bib` file** (from project files) and the **PDF compiler** (`pdflatex` | `xelatex`); persist to `ProjectSettings` and have Phase 3/4 honor them live.
- Polish: SyncTeX click-to-source both ways; share-link role management UI; version history/snapshots; `.zip` import/export.
- **Acceptance:** changing the compiler or central bib in Settings changes compile behavior and which keys the Library/autocomplete use; each shipped polish item has tests + a docs entry.

---

## 10. Repository layout (target)

```
freeleaf/
├─ apps/
│  ├─ web/          # React + Vite SPA (tabs: Editor co-view / Library / Settings)
│  ├─ api/          # Django + Django Ninja (auth, projects, files, settings, library)
│  ├─ collab/       # Yjs sync service (Node y-websocket, or Channels+pycrdt — see §6)
│  └─ compile/      # sandboxed TeX Live runner (pdflatex + xelatex)
├─ packages/
│  └─ shared/       # generated OpenAPI TS client + shared FE types
├─ docker/
│  ├─ texlive/      # sandbox image: TeX Live + pdflatex + xelatex + fonts
│  └─ ...
├─ docs/
│  ├─ security.md   # threat model + sandbox design (§7)
│  └─ decisions/    # ADRs, incl. collab.md (§6)
├─ docker-compose.yml
├─ PLAN.md          # this file
├─ LICENSE          # AGPL-3.0
└─ README.md
```

---

## 11. Testing & quality bar

- **Unit:** authorization (registered vs anonymous vs share-link), magic-link single-use/expiry, path sanitization, BibTeX detection + dedupe, log parsing.
- **Integration (compile):** valid doc under pdflatex and xelatex, error doc, timeout, shell-escape attempt, path traversal.
- **E2E (Playwright):** core loop — sign in (all three methods) → create project → edit → compile → co-view PDF; library flow — paste BibTeX → appears in Library → `\cite{}` autocompletes it.
- **Collab:** two clients converge; anonymous participant shows in presence.
- CI runs lint + typecheck + unit/integration on every push.

---

## 12. Working instructions for Claude Code

- Work in phase order. **After each phase, run its acceptance checks and report results before continuing.**
- Small, reviewable commits, one logical change each.
- When something isn't specified, pick the simplest secure option, implement it, and add an ADR in `docs/decisions/`.
- **Never weaken the compile sandbox (§7).** If it's hard to test locally, stub the boundary but preserve the security properties.
- Keep `README.md` runnable at all times: a fresh clone must build and start.
- Verify third-party specifics against current docs before relying on them — especially **ORCID OAuth2 endpoints/scopes** and, if chosen, **`pycrdt`** status.
- Flag any security or data-loss uncertainty instead of guessing.

---

## 13. Definition of done (MVP)

On a self-hosted instance a user can: sign in via ORCID, via magic link, or contribute anonymously (name optional); create a project; edit `main.tex` with a live source-and-PDF co-view; compile safely with their chosen compiler (pdflatex or xelatex) with no arbitrary code execution on the host; collaborate live with others (including anonymous participants); manage references in the Library tab with `\cite{}` autocomplete; and add BibTeX to the library by pasting or dropping it. `docker compose up` from a clean clone reproduces the full stack.