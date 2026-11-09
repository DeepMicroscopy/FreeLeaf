# ADR: Revision-diff linking — not in the original phased plan

**Status:** accepted

## Decision

Added Phase 14 (revision-diff linking) outside the original phased sequence in `PLAN.md` — same reasoning as Phase 13 (personal project collections): it was requested mid-session for a workflow the original plan didn't anticipate (revising a paper against reviewer feedback while seeing a permanent diff against the submitted version), not a deviation from an already-planned phase.

## Rationale

Resurrects `trackChangesExtension.ts` (removed in commit `5a4ddcd`, see `docs/decisions/suggested-edits.md`) rather than building new diff-decoration machinery — that removal was specifically about Reviewing mode needing per-author, per-character, concurrent-reviewer-aware suggestion tracking, which a static `diffLines` comparison can't express. Comparing a live document against a frozen, independent sibling file (this feature's use case) has none of those requirements, so the original mechanism is directly reusable, just renamed (`revisionDiffExtension.ts`, `cm-revisionInsert`/`cm-revisionDelete`) to stay unambiguous from Reviewing mode's own, differently-colored suggestion marks — the two systems are independent and may legitimately overlap visually.

## Consequences

- The linked baseline is fetched once per file-open (plain content, not live-synced) — a deliberate simplicity tradeoff, since the common case is diffing against a frozen past revision that won't be edited again. A manual Refresh affordance covers the rarer case where it does change mid-session; revisit with a Yjs-backed live sync only if that proves to matter in practice.
- Scoped to `.tex` files only, both ends of the link — a line diff isn't meaningful for `.bib`/image files, and the project's own `ProjectFileOut` has no notion of other "comparable" text types worth covering in v1.
