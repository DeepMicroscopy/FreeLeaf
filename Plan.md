# Build Plan / Claude Code Prompt — "FreeLeaf"

> An open and free, self-hostable, collaborative LaTeX editing platform.
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

The north star is the standard collaborative-LaTeX core loop — *edit → compile → co-view PDF* — plus real-time collaboration and frictionless, academic-friendly access (ORCID / magic link / anonymous). Ship that well before extras.

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

- **Open & free.** No proprietary cloud dependencies. License: **AGPL-3.0** (network service). State the choice in `LICENSE`.
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
- Add user management for admin users. They shall be able to see who is active, who as how many projects. Also, they are allowed to set the site settings:
- **Site settings**: Current features include: activate domain whitelist for signup via orcid. 
- **Acceptance:** changing the compiler or central bib in Settings changes compile behavior and which keys the Library/autocomplete use; each shipped polish item has tests + a docs entry.

### Phase 8 - Comments and Versioning
- **Editing** Introduce an editing mode, to be selected between "Writing", "Reviewing" and "Polishing". 
- **Track changes** In reviewing mode, changes are tracked and a visible diff is being displayed as markup. 
- **Visual Diff Markup** Render inline insertions with a green background/underline and deletions with a red background/strikethrough.
- **Comments** Allow users to add a comment to code. For this, add a new pane right to the text and left to the pdf view. Users may also reply to comments. Editors and owners may resolve comments. 
- **Polishing** A specialized UI layer focused on formatting, grammar, and typography. Keystrokes operate like Writing mode, but automated linting, LaTeX compilation warnings, and micro-typography checks (e.g., detecting missing non-breaking spaces ~ before citations, orphaned headings, or unescaped symbols) are aggressively surfaced.
- **Version Control & History**:
Automated Snapshots: Implement a debounce mechanism (e.g., 5 minutes of inactivity or every 1000 keystrokes) to automatically commit a version history checkpoint.
Named Versions: Allow users to manually freeze the current state, adding a custom label and description (e.g., "Draft Submitted to Advisor").
Time Travel UI: A toggleable sidebar replacing the review pane, allowing users to scroll through past commits, view a side-by-side split file diff, and trigger a Restore to this Version action.

Additionally, some polishing in phase 8:
**Warnings**: Present warnings only of last latex run. Else, in particular unknown citations will be shown as warnings for every compile, which does not make sense.

### Phase 9 — Institutional SSO (multi-tenant SAML/Shibboleth + LDAP/AD)
- **Goal:** extend sign-in beyond ORCID/magic-link/anonymous to institutional identity providers, so any university can bring its own SSO. **Multi-tenant**: one FreeLeaf deployment supports many institutions at once, each with its own connection, not a single global config.
- **`SsoProvider` registry** (admin-managed, `accounts` app): one row per institution, `kind` = `saml` (Shibboleth or any standards-compliant SAML 2.0 IdP) or `ldap` (on-prem LDAP or Active Directory, both spoken via the LDAP protocol — AD is a connection-detail variant, not a separate integration path). Fields cover exactly what each kind needs to authenticate (see §8 for the concrete schema): for SAML, the IdP's entity ID/SSO URL/signing cert and which response attributes carry email/display name; for LDAP/AD, the server URI, a service-account bind DN/password for the search phase, the user search base/filter, and attribute mappings. `ldap_bind_password` is encrypted at rest (Fernet key derived from `SECRET_KEY`) as defense in depth — this is not a substitute for proper secrets management in a real deployment, and is documented as such.
- **Discovery UX:** the login page gets a searchable "Sign in with your institution" picker (a Shibboleth-style Discovery Service / WAYF pattern — list, not domain-guessing) listing enabled `SsoProvider`s, alongside the existing "Sign in with ORCID" button.
- **SAML flow:** `GET /auth/saml/{slug}/login` builds an AuthnRequest and redirects to the provider's IdP; `POST /auth/saml/{slug}/acs` validates the signed response against the stored IdP cert and completes sign-in — same session/`log_in()` mechanism as ORCID, not a parallel auth system.
- **LDAP/AD flow:** a per-provider login form (username + password) posts to `POST /auth/ldap/{slug}/login`; server does a search+bind (bind as service account → search for the user → bind again as the user's own DN to verify the password — the standard secure LDAP auth pattern, since AD/LDAP directories don't hand out password hashes for direct comparison).
- **User linking:** a new `User.Kind.SSO` (or reuse `email`? — decide during implementation) keyed by `(provider, external_id)`, mirroring how ORCID users are keyed by `orcid_id`; email/display name populated from whichever attributes the provider maps.
- **Admin UI:** a new "SSO Providers" screen (extends the Phase 7 admin area) to add/edit/enable/disable/delete providers — write-only for secrets (bind password, cert are never round-tripped back to the client after being set).
- **Test infrastructure (no real institutional IdP available):** a disposable test SAML IdP (`kristophjunge/test-saml-idp`, SimpleSAMLphp-based) and a disposable OpenLDAP container added to `docker-compose.yml` for live verification of both flows end-to-end, standing in for a real university's Shibboleth IdP / AD server. Flagged clearly: this verifies the *integration* works correctly against the SAML 2.0 spec and standard LDAP bind semantics, not against any specific real institution's quirks — a final pass against a real IdP is recommended once one is available.
- **Acceptance:** an admin can register a SAML provider and an LDAP provider through the admin UI; a user can complete sign-in through each against the respective test server and lands in a real session; secrets are never exposed via any read API; disabling a provider removes it from the login picker without deleting existing linked users.

### Phase 10 — Table designer
- **Goal:** a spreadsheet-like interactive UI for building/editing `tabular`-family LaTeX tables, so authors don't have to hand-write column specs, `&`/`\\` separators, and `\hline`s.
- **Discovery affordance:** a small table icon in the editor gutter on the line where a `\begin{tabular}` (and `tabular*`/`tabularx`/`longtable`) starts, clicking it opens the Table Designer for that table.
- **Table Designer UI:** an interactive grid — add/remove rows and columns, edit cell text directly, set per-column alignment (`l`/`c`/`r`), toggle borders (`|` between columns, `\hline` between rows). Opens pre-populated by parsing the table currently between `\begin{tabular}{...}` and `\end{tabular}`; saving serializes the grid back to LaTeX and replaces that exact range in the (Yjs-shared) document, so co-editors see the update live like any other edit.
- **Scope, stated up front:** targets the common case — simple grids with basic alignment/borders, `\multicolumn`/`\multirow` cell merging, and booktabs rules (`\toprule`/`\midrule`/`\bottomrule`, tracked per-slot alongside `\hline` so each round-trips to the exact macro it came from) — not a full LaTeX table parser. Nested tables, custom column types (`p{}`, `m{}`, etc.), `\cline`, and a cell combining colspan *and* rowspan at once (`\multicolumn{...}{...}{\multirow{...}}`) are out of scope; same "best-effort, not a real parser" discipline already used for `log_parser.py`/`polishingLint.ts`. A table using anything outside that scope should be left untouched (detected and reported as "not editable here") rather than silently mangled.
- **Merging cells:** a plain cell shows small merge controls (merge right into a `\multicolumn`, merge down into a `\multirow`) when a mergeable plain neighbor exists; a merged cell shows its own alignment/border controls (or a width field for `\multirow`) plus a split control to revert it back to plain cells. Add/remove row and column controls are disabled wherever a merge touches that row/column, so removal never has to guess how to shrink or re-route a span.
- **Matches real LaTeX leniency, not just a naive `&`/`\\` split:** an escaped `\&` is literal text, not a cell separator; a `\\` used for line-breaking *inside* a cell's own braces (`\thead{a\\b}`, `\shortstack{a\\b}`, etc.) is literal text, not a row separator — both checks are brace-depth-aware, same as `\hline`/`&` already were. A row may also have *fewer* trailing `&`-separated cells than the column count — real `tabular` silently blanks the rest, so we do too (a mismatch in the *middle* of a row is still rejected, since that's genuinely ambiguous).
- **Acceptance:** clicking the gutter icon on a simple existing table (including one already using `\multicolumn`/`\multirow`/booktabs rules/escaped `\&`/multi-line cell macros/omitted trailing cells) opens the designer pre-filled with its actual contents, spans rendered as merged cells; editing cells/rows/columns/alignment/spans and saving updates the source correctly and round-trips (re-opening shows the same grid); a table using an out-of-scope construct (nested environment, `\cline`, combined colspan+rowspan on one cell, a `\multirow` placeholder that isn't empty, a span that overflows/overruns the table, a cell-count mismatch in the middle of a row) is left alone with a clear message, never corrupted.
- **Known gap, queued for next round:** cell text is currently plain — a cell containing `\textbf{...}`/`\textit{...}`/`\underline{...}`/etc. round-trips correctly (the tokenizer already treats it as opaque literal text, brace-depth-aware) but shows up as raw LaTeX source in the cell's text input, with no WYSIWYG way to apply/toggle formatting on selected cell text from the grid UI itself. Next implementation round should add inline formatting controls (bold/italic/underline at minimum) to the cell editor.

### Phase 11 — First-run setup, configurable ORCID, sidebar navigation, in-file search
- **Goal:** make a fresh self-hosted install immediately usable without a database shell, let ORCID be genuinely optional rather than assumed, and round out everyday navigation/search in the editor.
- **First-run setup wizard:** when no admin user exists yet (`is_admin=True` count is zero), any visitor is routed to a one-time setup flow instead of the normal login page. Step 1 picks which auth method(s) to enable (ORCID on/off; any Phase 9 SSO providers configured later); step 2 authenticates the soon-to-be admin through one of the just-enabled methods. Since this app has no password auth at all (ORCID/magic-link/anonymous only, by design), "creating the first admin" means completing sign-in once during active setup mode — whichever identity completes it is automatically flagged `is_admin=True`, and setup mode then closes for good. Magic-link sign-in during setup is a deliberate, narrow exception to the existing "only via a project ShareLink invite" rule (see login page copy), since no project/owner can exist yet at this point — gated purely by "no admin exists yet," not reachable once one does.
- **ORCID configurable via the admin UI:** ORCID's client id/secret/redirect/sandbox-vs-production are currently environment-variables-only, read once at process start (`accounts/orcid.py`), with no way to disable it short of code changes. Move an `orcid_enabled` toggle (and optionally credential overrides, falling back to env vars if left blank so existing deployments are unaffected) into the DB-backed site settings the admin UI already manages (Phase 7's "Site settings" screen, alongside the existing domain-whitelist toggle) — same write-only-secret pattern as Phase 9's SSO providers. Disabling ORCID immediately hides its button from the login page and the setup wizard's provider picker, no restart needed; the remaining enabled method(s) (invite-gated magic link, anonymous, any configured institutional SSO) still work. Block disabling the last remaining enabled method so an admin can't lock everyone out.
- **Sidebar tab view (Files / Outline / Figures & Tables):** the left panel gains a small tab strip at the bottom switching between the existing file tree, a live **Outline** (parsed from `\part`/`\chapter`/`\section`/`\subsection`/`\subsubsection` and their `*` variants in the currently open file), and a live **Figures & Tables** list (`\begin{figure}`/`\begin{table}` environments, showing caption text if present else a snippet). Both new views are read-only navigation aids, recomputed debounced on doc change (same pattern as track-changes/polishing-lint), and clicking an entry jumps/scrolls the editor to it (reusing the jump-to-line plumbing SyncTeX and comments already use) — same "best-effort scan, not a full parser" discipline as the rest of the editor tooling.
- **Full-text search in the current file:** a find/replace bar for the currently open file, built on CodeMirror's own `@codemirror/search` extension rather than hand-rolled — Cmd/Ctrl-F opens it, with case-sensitivity/regex toggles, match highlighting, next/previous navigation, and replace/replace-all (gated by the same write permission as editing, and applied as a normal edit to the live Yjs-shared document so co-editors see it). Deliberately scoped to the current file only — project-wide search across every file is a bigger, separate feature (would need a backend index) and isn't part of this phase.
- **Acceptance:** a brand-new database redirects every visitor to the setup wizard until it's completed, after which exactly one admin exists and the wizard never reappears; toggling ORCID off/on in the admin UI changes the login page immediately for all users, with the last-enabled-method guard preventing lockout; the sidebar's Outline and Figures & Tables tabs stay live as the document changes and clicking any entry navigates the editor correctly; Cmd/Ctrl-F search/replace works correctly against the live collaborative document.

### Phase 12 - Implement Package wizard


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