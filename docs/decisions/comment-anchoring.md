# ADR: Comment anchoring by text re-location, not Yjs relative positions

**Status:** accepted

## Decision

Re-anchor comments by re-locating their captured `anchor_text` in the live document client-side (nearest occurrence to the last known position), rather than encoding a Yjs relative position at creation time.

## Rationale

- The original design intentionally stored `anchor_line`/`anchor_from`/`anchor_to` as a one-time snapshot, accepting that it could drift. In practice this meant any edit above a comment left it pointing at the wrong line indefinitely, and a comment whose marked text was deleted stayed anchored to whatever content later occupied that stale range — both confirmed as real problems.
- A Yjs relative position would need a new binary column, a live Y.Doc connection at comment-creation time (via a `citeKeyRename.ts`-style background connection for the cases where the editor tab isn't already open), and still wouldn't handle a cut-and-pasted sentence moving elsewhere — that's new CRDT items at the paste site, not a tracked move.
- Re-locating the captured text string handles line insertion/deletion *and* cut-and-paste moves identically (the text is found wherever it now is), requires no schema migration, and makes "the text no longer exists anywhere in the document" a direct, unambiguous signal rather than an inference from relative-position resolution.

## Consequences

- `anchor_text` must be captured for every top-level comment, including whole-line ones (previously null) — a plain comment now anchors to that line's full text.
- `anchor_line`/`anchor_from`/`anchor_to` remain a cache refreshed by whichever client has the file open (`PATCH .../comments/{id}/anchor`), not the source of truth — a file nobody currently has open can still show stale values until someone reopens it.
- ~~A comment whose text can no longer be found is deleted outright (`DELETE .../comments/{id}/orphaned`), not auto-resolved — permanent, by explicit choice, since "the annotated thing no longer exists" was judged to make the comment itself meaningless rather than just "handled."~~ **Revised:** in practice this meant a reviewer's feedback silently vanished the moment anyone rewrote the sentence it was attached to — exactly the kind of review history this whole anchoring system exists to preserve. A comment whose text can no longer be found is now flagged `anchor_lost_at` (`POST .../comments/{id}/anchor-lost`) instead of deleted: `anchor_line`/`anchor_from`/`anchor_to`/`anchor_text` freeze at their last-resolved values (a record of where it used to point), the thread stays fully visible and usable (reply, resolve, manual delete), and the flag clears itself if a later edit (e.g. an undo) brings the exact text back.
