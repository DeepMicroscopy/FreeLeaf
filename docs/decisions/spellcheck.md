# ADR: English spell-checking uses the browser's native spell-checker

**Status:** accepted (Phase 8, Polishing mode)

## Decision

Spell-checking is the browser's own built-in spell-checker (`spellcheck="true"` on the editor's content DOM), not a bundled JS dictionary (e.g. nspell/typo-js) or a self-hosted LanguageTool service.

## Rationale

Zero new dependencies, zero bundle weight, no network calls, and it reuses each user's own OS/browser dictionary (and its "add to dictionary"/suggestion UI) for free, consistent with the project's self-hosted, minimal-footprint ethos. The real work is keeping it usable on a LaTeX document: a bare `spellcheck="true"` would flag every command name, math variable, and file path as a misspelling, so `spellcheckExclusion.ts` marks all non-prose text (`spellcheck="false"`) using the syntax tree the editor's existing stex highlighting already builds, plus a narrow regex for the handful of commands (`\includegraphics`, `\href`, `\url`, ...) that highlighting doesn't tag distinctly from prose.

## Consequences

- No control over the exact word list or suggestions — whatever the viewer's own browser/OS provides. A LaTeX/academic term the browser doesn't know will still show as misspelled; there's no per-document ignore-list.
- Behavior (squiggle style, right-click suggestions, "add to dictionary" persistence) varies slightly by browser, and does nothing if the user's browser has spell-check disabled — both acceptable since this is a passive aid, not a validation gate.
- Real grammar checking (not just spelling) would need a different approach (e.g. a LanguageTool service) — out of scope here.
