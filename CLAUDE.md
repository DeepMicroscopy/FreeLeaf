# CLAUDE.md — FreeLeaf

Open-source Overleaf alternative. Full spec: **`PLAN.md`** (read on demand, don't restate). This file is loaded every session — keep it, and your working style, token-lean.

## Token discipline (primary directive)
- Cite `PLAN.md §N` instead of quoting it. Never paste the plan back.
- Read the minimum: `grep`/glob to locate, then open only the needed line range. Don't read whole files or dirs "to be safe."
- Don't re-read what's already in context. Trust prior reads unless the file changed.
- Edit with targeted `str_replace`, not full-file rewrites.
- Cap tool output: pipe noisy commands to `head`/`tail`, use `grep -n --max-count`, `git --stat`, `ls` over recursive dumps. Never cat lockfiles, `node_modules`, build output, PDFs, or migrations wholesale.
- Responses: terse, no preamble/postamble/recap. State what changed + the one next step. Skip ASCII diagrams and restating my request.
- Batch related edits into one commit; don't narrate each micro-step.
- Ask before large exploratory reads if a cheaper path exists.

## Stack (see §4)
Django + Django Ninja (api) · React+Vite+TS (web) · CodeMirror 6 · PDF.js · Yjs (collab, §6) · Postgres · MinIO · sandboxed TeX Live pdflatex+xelatex (§7). Types: OpenAPI → generated TS client, don't hand-write.

## Repo map
```
apps/web  apps/api  apps/collab  apps/compile
packages/shared  docker/  docs/  PLAN.md
```
Locate code by grep, not by opening trees.

## Commands
- Up: `docker compose up`
- api: `cd apps/api && python manage.py <cmd>` · test `pytest -q` · lint `ruff check`
- web: `pnpm --filter web <script>` · lint `pnpm lint` · e2e `pnpm playwright test`
- Prefer `-q`/quiet flags; avoid watch/verbose modes in one-shot runs.

## Debugging (see your source, not library noise)
The "bunch of JS in DevTools" is un-ignored vendor code, not missing maps. Fix:
- **Ignore-list:** DevTools → Settings → "Automatically add known third-party scripts to ignore list" = ON. Vite emits `x_google_ignoreList` for deps, so `node_modules` + `.vite/deps` vanish from Sources/stack traces and your `.tsx` shows under the dev origin. Stray frame → right-click → "Add script to ignore list".
- **Source maps:** on by default in dev. Prod: set `build.sourcemap: true` in `vite.config.ts`. Keep `esbuild` defaults (readable dev output; don't minify in dev).
- **Set breakpoints in `.tsx` source**, not compiled output; `debugger` sparingly.
- **React:** use React DevTools (Components/Profiler), not raw JS. Enable "Highlight updates" for re-render bugs.
- **CRDT/collab:** not a React-DevTools problem — debug with two browser profiles on one doc + structured logging of Yjs updates (`ydoc.on('update', …)`). See §6.
- Repro FreeLeaf's real hard bugs (sync, CodeMirror, compile) with logs, not the Sources panel.

## Guardrails (do not violate)
- **Sandbox §7 is inviolable.** `-no-shell-escape` on both compilers, `--network none`, ephemeral, limits, non-root. Never relax for convenience.
- **Phase order (§9).** Finish + verify a phase's acceptance checks before the next. Report pass/fail briefly, then continue.
- **Auth model (§8, Phase 1):** ORCID + magic link + anonymous; anonymous reaches projects only via ShareLink.
- Deviations → one-paragraph ADR in `docs/decisions/`, nothing more.
- Verify ORCID endpoints and (if used) `pycrdt` against live docs before building on them.

## Conventions
- TS strict; Ruff/Black for Python.
- Small commits, imperative subject, one logical change.
- Don't add deps, docs, or scaffolding not required by the current phase.
- Flag security/data-loss uncertainty instead of guessing.