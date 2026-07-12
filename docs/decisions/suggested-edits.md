# ADR: Reviewing mode's track changes becomes real CRDT-based suggestions

**Status:** accepted (post-Phase 11)

## Decision

Replaced the diff-against-a-snapshot-baseline track-changes markup (`trackChangesExtension.ts`, itself a deliberately scoped-down Phase 8 decision) with real per-character, per-author "suggested edits": insertions and deletions made while in Reviewing mode are tagged directly on the shared Yjs `Y.Text` as rich-text formatting attributes (`sugg: "ins" | "del"`, `authorId`, `authorName`, `ts`) rather than actually mutating the document. A suggested deletion is never a real `Y.Text.delete` — the text stays in the document, struck through, until Accepted (really deleted) or Rejected (un-tagged).

## Rationale

The Phase 8 ADR explicitly chose diffing over "a live per-keystroke CRDT-attributed suggestion layer" as "a much bigger, riskier undertaking on top of Yjs." Two things changed: the user asked specifically for word-level (not line-level) granularity, per-author color coding, and per-suggestion accept/reject — none of which a text diff against a static baseline can express once more than one person has edited since that baseline. And a new "reviewer" role needed *every* edit to be a suggestion, permanently, which a manually-toggled diff baseline can't guarantee either.

Doing the bigger version properly instead of layering workarounds onto the diff approach: decorations are read directly from the live `Y.Text` (no diff step at all), work correctly with concurrent reviewers, and survive reload/reconnect for free, because it's just part of the CRDT.

## Consequences

- CodeMirror's `EditorView` gets a custom `dispatchTransactions` (not the default) that rewrites local edit transactions while suggesting: deletions are converted to "keep the text, tag it" (`suggestionRewrite.ts`), and a lone Backspace explicitly repositions the cursor *before* the now-struck-through range (left alone, it would never move, and repeated Backspaces would restrike the same character forever instead of eating further back).
- Continuous typing coalesces into one suggestion span via Yjs's own format-inheritance-on-insert behavior (`suggestions.ts`'s `ensureSuggestionTag`), not a bespoke timer — verified this is real Yjs behavior, not assumed.
- Table Designer saves and BibTeX paste-insertion explicitly tag their programmatic `view.dispatch()` calls with a `userEvent` so they're swept into suggestion-mode too — a reviewer must never be able to bypass suggestions via a different UI entry point than typing.
- The old "mark current as new baseline / revert project to baseline" toolbar is unrelated and unchanged — it's a whole-project safety revert, independent of per-character suggestion tracking, and still uses `ProjectSnapshot`.
- Known limitation: accept/reject is per-hunk, not attributable across a hunk if two different reviewers' suggestions land adjacently at the exact same position with the same timestamp (an extremely narrow race); this matches the project's existing "simple, honest, best-effort" tolerance elsewhere (comment anchor drift, the outline scanner).
