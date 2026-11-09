# ADR: Session-scoped incremental compile cache

**Status:** accepted

## Decision

Let one browser tab's repeated compiles of the same project reuse the previous compile's `src`/`out` directories instead of starting from an empty one every time (`apps/compile/sandbox.py`'s `run_job`, keyed by a client-minted `session_id`), so `latexmk`'s own incremental rebuild can actually skip reprocessing unchanged files. Size-capped (300 MB) and idle-evicted (30 min) per session.

## Rationale

Every compile previously did a full, clean `latexmk` rebuild (Plan §7's "fresh container per job, removed after" applied to the whole job directory, not just the container). For large documents this makes every auto-compile (~every 2.3s of editing pause) pay the full document's cost even when one paragraph changed.

Verified before building this, not assumed:
- `latexmk`'s primary staleness check is modification-time based (confirmed via its own docs), not content/checksum based. Persisting `out/` alone, with `src/` wiped and freshly re-extracted every call, would buy nothing.
- `apps/api/projects/compile_api.py`'s `materialize_tar` never set `TarInfo.mtime` (defaulting to epoch 0) — every file got the identical mtime on every compile, unconditionally. Harmless only because `out/` was always wiped (latexmk never had a `.fdb_latexmk` to compare against). Persisting `out/` without fixing this would make latexmk see "unchanged since last run" for every file, including genuinely edited ones, and silently serve stale PDFs.

Fixed by stamping each tar member's mtime from `ProjectFile.updated_at` (already bumped exactly on content changes) and no longer wiping `src/`+`out/` between compiles of the same session. `tarfile.extractall()`'s own mtime-restoration then does the right thing for free. Verified live: a second compile with no changes shows `latexmk: Nothing to do for 'main.tex'` / `All targets () are up-to-date` and runs ~5x faster; a real edit is still correctly picked up; a Reviewing-mode suggestion added between two compiles of the same session is correctly reflected, not served stale.

## Consequences

- **Sandbox §7 is not relaxed for the container itself** — every individual sandboxed run remains exactly as ephemeral, isolated, non-root, network-disabled, and resource-limited as before, with no exception. What's new is a host-side directory that persists *across* calls for one session.
- **No new trust boundary**: a session's cache holds only that same project's own content and its own previous (identically sandboxed) build output. Session ids are opaque, client-minted, per-tab UUIDs — validated against a tight allowlist before use as a path component — and are never shared across projects, users, or sessions.
- **Bounded, not unbounded**: a runaway or malicious document bloating its own cached output across many compiles hits a 300 MB cap and self-heals (cache wiped, that one compile runs cold) rather than growing forever. An abandoned session is swept after 30 minutes idle by a background thread in `apps/compile/main.py` (the first background/periodic task in this codebase — no Celery/cron/APScheduler exists elsewhere).
- **Always a pure performance hint**: omitting `session_id`, or passing an invalid one, falls back to the original one-shot-per-call behavior with zero behavior change — this can never be the reason a compile fails or produces a wrong result, only the reason it's sometimes slower.
- If the cache is ever found to serve stale output, the correctness bug is almost certainly in the mtime-stamping (`materialize_tar`) or the pruning step (`_prune_missing`), not in `latexmk` itself — check those first.
