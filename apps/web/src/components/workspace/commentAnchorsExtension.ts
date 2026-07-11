import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

// Highlights the marked text range a comment is attached to (Plan.md §9
// Phase 8 extension: comments on selected text, not just a whole line).
// Same StateField/StateEffect shape as trackChangesExtension.ts.
export const setCommentAnchorDecorations = StateEffect.define<DecorationSet>();

export const commentAnchorsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentAnchorDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export interface CommentAnchor {
  from: number;
  to: number;
  resolved: boolean;
}

/** Builds decorations for each comment's marked range, clamped to the
 * current document length — anchors are plain character offsets captured
 * at creation time (see Comment model docstring), so a range can end up
 * stale/out-of-bounds after enough edits; clamping keeps that "honest
 * drift" harmless instead of throwing. */
export function computeCommentAnchorDecorations(anchors: CommentAnchor[], docLength: number): DecorationSet {
  const marks = anchors
    .map((a) => ({ from: Math.max(0, Math.min(a.from, docLength)), to: Math.max(0, Math.min(a.to, docLength)), resolved: a.resolved }))
    .filter((a) => a.to > a.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((a) =>
      Decoration.mark({ class: a.resolved ? "cm-commentAnchorResolved" : "cm-commentAnchor" }).range(a.from, a.to),
    );
  return Decoration.set(marks, true);
}
