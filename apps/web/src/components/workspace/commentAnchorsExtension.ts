import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

// Highlights the marked text range a comment is attached to (Plan.md §9
// Phase 8 extension: comments on selected text, not just a whole line).
// Same StateField/StateEffect shape as suggestionsExtension.ts.
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
  id: string;
  from: number;
  to: number;
  resolved: boolean;
}

/** Builds decorations for each comment's marked range, clamped to the
 * current document length — anchors are plain character offsets captured
 * at creation time (see Comment model docstring), so a range can end up
 * stale/out-of-bounds after enough edits; clamping keeps that "honest
 * drift" harmless instead of throwing. Each decoration carries the
 * originating comment's `id` in its spec (CodeMirror preserves arbitrary
 * extra fields on a mark's spec) so a click on the marked text can look up
 * *which* comment it belongs to — see `findCommentAnchorAt`. */
export function computeCommentAnchorDecorations(anchors: CommentAnchor[], docLength: number): DecorationSet {
  const marks = anchors
    .map((a) => ({ id: a.id, from: Math.max(0, Math.min(a.from, docLength)), to: Math.max(0, Math.min(a.to, docLength)), resolved: a.resolved }))
    .filter((a) => a.to > a.from)
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((a) =>
      Decoration.mark({ class: a.resolved ? "cm-commentAnchorResolved" : "cm-commentAnchor", commentId: a.id }).range(a.from, a.to),
    );
  return Decoration.set(marks, true);
}

/** Looks up the comment id (if any) whose marked-text decoration covers
 * document position `pos` in the given editor state. */
export function findCommentAnchorAt(state: EditorState, pos: number): string | null {
  let found: string | null = null;
  state.field(commentAnchorsField).between(pos, pos, (_from, _to, deco) => {
    found = (deco.spec as { commentId?: string }).commentId ?? null;
    if (found) return false;
  });
  return found;
}
