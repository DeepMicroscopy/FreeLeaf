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

/** Turns "what the user just typed/deleted" into "what should actually
 * happen to the document while suggesting": deletions never remove text
 * (only Accept does that later), and insertions land immediately after
 * whatever they would have replaced, so a like-for-like replacement shows
 * as adjacent struck-through-old / underlined-new rather than a silent
 * swap. Pure function over CodeMirror's own change-iteration API — no Yjs,
 * no EditorView, so it's testable with a plain EditorState. */
export function planSuggestionRewrite(tr: Transaction): SuggestionRewritePlan {
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
      if (deletionStart === null) deletionStart = newPos;
      formatOps.push({ kind: "del", from: newPos, to: newPos + (toA - fromA) });
      newPos += toA - fromA;
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
