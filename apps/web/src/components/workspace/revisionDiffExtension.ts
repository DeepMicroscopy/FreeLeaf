import { diffWordsWithSpace } from "diff";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

// Revision-diff linking: two files can be linked as revisions of each
// other (files_api.py's ProjectFile.diff_baseline) so the editor shows a
// permanent diff of the live document against the linked "previous copy"
// file's content — e.g. seeing what's changed since a paper's submitted
// version while revising against reviewer feedback. Adapted from
// trackChangesExtension.ts (removed in 5a4ddcd, recovered via `git show
// 5a4ddcd^:...`) — that mechanism was replaced for Reviewing mode's
// suggestion tracking specifically because that use case needed
// per-author, per-character, concurrent-reviewer-aware tracking, which a
// static diff can't express (docs/decisions/suggested-edits.md). Neither
// concern applies here: comparing against a frozen, independent sibling
// document is exactly what a static diff is good at, so the two systems
// coexist independently (and may legitimately overlap visually — a
// suggested edit inside a revision-diff region is fine, ordinary
// CodeMirror decoration layering).
export const setRevisionDiffDecorations = StateEffect.define<DecorationSet>();

export const revisionDiffField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRevisionDiffDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class RemovedRevisionTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: RemovedRevisionTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-revisionDelete";
    span.textContent = this.text;
    return span;
  }
}

/** Computes decorations by walking `diffWordsWithSpace(baselineText,
 * currentText)` hunk by hunk, tracking a running position in `currentText`
 * — unchanged and added hunks advance that position (their text is really
 * there in the live doc); removed hunks don't (their text only exists in
 * the baseline), so they're rendered as a zero-width widget at the
 * position they would have occupied.
 *
 * Word-level, not line-level: an early version used `diffLines`, which
 * marked an *entire line* as removed+added whenever even one word changed
 * within it — confusing (looked like a full rewrite for a single-digit
 * edit, e.g. "365 cases" → "122 cases" struck through both whole
 * sentences). `diffWordsWithSpace` (preserves whitespace/newlines as real
 * content, unlike plain `diffWords`) narrows the decoration down to just
 * the words that actually changed, while this function's own hunk-walking
 * logic is otherwise unchanged — `diffLines`/`diffWordsWithSpace` return
 * the same `Change[]` shape either way. */
export function computeRevisionDiffDecorations(baselineText: string, currentText: string): DecorationSet {
  if (baselineText === currentText) return Decoration.none;
  const parts = diffWordsWithSpace(baselineText, currentText);
  const decorations = [];
  let pos = 0;

  for (const part of parts) {
    if (part.added) {
      const length = part.value.length;
      if (length > 0) decorations.push(Decoration.mark({ class: "cm-revisionInsert" }).range(pos, pos + length));
      pos += length;
    } else if (part.removed) {
      if (part.value.length > 0) {
        decorations.push(
          Decoration.widget({ widget: new RemovedRevisionTextWidget(part.value), side: -1 }).range(pos),
        );
      }
    } else {
      pos += part.value.length;
    }
  }

  return Decoration.set(decorations, true);
}
