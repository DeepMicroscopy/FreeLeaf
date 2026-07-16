import type { ChangeSpec, Transaction } from "@codemirror/state";

export interface SuggestionFormatOp {
  kind: "ins" | "del";
  from: number;
  to: number;
}

export interface SuggestionRewritePlan {
  /** Change specs (relative to the transaction's *original* document) that
   * replace the transaction's own changes — every deletion suppressed
   * (kept in place) and every insertion moved to sit right after whatever
   * it would otherwise have replaced. `null` if the transaction contains no
   * document changes at all. */
  changes: ChangeSpec[] | null;
  /** Ranges to tag on the Y.Text afterwards, in the coordinates of the
   * document that results from applying `changes` above (which — since no
   * real deletion ever happens — is exactly the coordinate space Y.Text
   * ends up in once yCollab mirrors this transaction). */
  formatOps: SuggestionFormatOp[];
  /** Where to put the cursor — always explicit, never left to CodeMirror's
   * own default-mapped selection. That default maps the *old* selection
   * through the new ChangeSet, but a suppressed deletion's ChangeSet is
   * (partly or fully) empty, so a *wide* selection (selecting a word, then
   * pressing Delete) would map to itself, staying wide and uncollapsed
   * forever — meaning every subsequent keystroke replaces that same stale
   * range at the same position instead of advancing, which visibly
   * reverses typed text ("PROBE" landing as "EBORP"). `null` only when the
   * transaction has no changes to apply at all. */
  selectionAnchor: number | null;
}

/** Splits a raw deleted range `[fromA, toA)` (old-document coordinates)
 * against the document's existing *unaccepted* insertion spans (same
 * coordinate space) into ordered sub-ranges, each tagged `retract: true`
 * (falls inside a still-pending insertion — nobody has accepted it yet, so
 * deleting it should just make it vanish) or `retract: false` (falls on
 * already-real text, or on an already-tracked deletion — the normal
 * suppress-and-tag-as-"del" case). A single Backspace/Delete can span both
 * in one go (e.g. selecting "brown fox" where "brown" is your own pending
 * suggestion and " fox" is real text). */
function splitDeletionRange(
  fromA: number,
  toA: number,
  pendingInsertions: { from: number; to: number }[],
): { from: number; to: number; retract: boolean }[] {
  const overlaps = pendingInsertions
    .map((s) => ({ from: Math.max(s.from, fromA), to: Math.min(s.to, toA) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);

  const segments: { from: number; to: number; retract: boolean }[] = [];
  let cursor = fromA;
  for (const ov of overlaps) {
    if (ov.from > cursor) segments.push({ from: cursor, to: ov.from, retract: false });
    segments.push({ from: ov.from, to: ov.to, retract: true });
    cursor = ov.to;
  }
  if (cursor < toA) segments.push({ from: cursor, to: toA, retract: false });
  return segments;
}

/** Turns "what the user just typed/deleted" into "what should actually
 * happen to the document while suggesting": deletions of *real* text never
 * remove it (only Accept does that later) — but deleting text that's still
 * a pending, unaccepted insertion suggestion (anyone's — it was never part
 * of the "real" document to begin with) actually removes it, matching how
 * Google Docs/Word suggesting mode collapses a retracted draft insertion
 * instead of layering a redundant "suggested deletion of a suggested
 * insertion" on top. Plain insertions land immediately after whatever they
 * would have replaced, so a like-for-like replacement shows as adjacent
 * struck-through-old / underlined-new rather than a silent swap. Pure
 * function over CodeMirror's own change-iteration API plus a caller-supplied
 * snapshot of existing spans — no Yjs, no EditorView, so it's testable with
 * a plain EditorState. */
export function planSuggestionRewrite(
  tr: Transaction,
  pendingInsertions: { from: number; to: number }[] = [],
): SuggestionRewritePlan {
  if (!tr.docChanged) return { changes: null, formatOps: [], selectionAnchor: null };

  const changes: ChangeSpec[] = [];
  const formatOps: SuggestionFormatOp[] = [];
  let newPos = 0;
  let prevToA = 0;
  let changeCount = 0;
  let sawInsertion = false;
  let deletionStart: number | null = null;

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changeCount++;
    newPos += fromA - prevToA;
    prevToA = toA;

    if (toA > fromA) {
      for (const seg of splitDeletionRange(fromA, toA, pendingInsertions)) {
        const segLen = seg.to - seg.from;
        if (seg.retract) {
          // Was never real, accepted content — actually delete it, don't
          // suppress-and-tag. Doesn't advance newPos: it's gone from the
          // resulting document, not kept in place like a tracked deletion.
          changes.push({ from: seg.from, to: seg.to, insert: "" });
        } else {
          if (deletionStart === null) deletionStart = newPos;
          formatOps.push({ kind: "del", from: newPos, to: newPos + segLen });
          newPos += segLen;
        }
      }
    }
    if (inserted.length > 0) {
      sawInsertion = true;
      changes.push({ from: toA, to: toA, insert: inserted });
      formatOps.push({ kind: "ins", from: newPos, to: newPos + inserted.length });
      newPos += inserted.length;
    }
  });

  // Backward deletion (Backspace) with nothing typed to replace it: park the
  // cursor *before* the newly-struck-through range so repeated Backspaces
  // keep eating further back, instead of never moving at all. Every other
  // case (typing, pasting, Delete, or replacing a selection) lands the
  // cursor right after everything that just happened — the natural "keep
  // going from here" position, and critically *always* collapsed to a
  // single point rather than left as a stale wide selection.
  const isLoneBackwardDelete = changeCount === 1 && !sawInsertion && tr.isUserEvent("delete.backward");
  return { changes, formatOps, selectionAnchor: isLoneBackwardDelete ? deletionStart : newPos };
}

/** Whether a transaction represents a suggestable local edit at all: real
 * typing, pasting, dropping, deleting, autocompletion, or a search-panel
 * replace (all "input.*"/"delete.*" per CodeMirror's own `userEvent`
 * taxonomy) — but never undo/redo (those must actually undo, not stack
 * another suggestion on top), and never a transaction with no `userEvent`
 * at all, which covers both Yjs's own remote-mirroring dispatches (see
 * y-codemirror.next's YSyncPluginValue, which never sets `userEvent`) and
 * this editor's own programmatic dispatches (jump-to-line, etc.) that
 * don't want to be suggestions. Table-Designer edits and BibTeX
 * paste-insertion explicitly tag their dispatches with `userEvent: "input"`
 * for exactly this reason — see CodeMirrorEditor.tsx. */
export function isSuggestableEdit(tr: Transaction): boolean {
  return tr.docChanged && (tr.isUserEvent("input") || tr.isUserEvent("delete"));
}
