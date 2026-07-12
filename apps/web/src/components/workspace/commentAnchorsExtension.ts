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
 * drift" harmless instead of throwing.
 *
 * `currentDecorations` (the field's own live value, already kept correctly
 * positioned edit-by-edit via CodeMirror's own `deco.map()`) takes priority
 * over the anchor's raw stored offsets for any comment that already has a
 * decoration — a real, previously-reproduced bug: `commentAnchors` is a
 * freshly-built array on every render of the *parent* editor tab (not
 * memoized against unrelated state like cursor position), so this recompute
 * fires far more often than "the comment list changed." Recomputing purely
 * from the stale stored offsets every time silently snapped an already
 * correctly-drifted anchor back to its stale creation-time position on
 * nearly every keystroke — looking exactly like a highlighted comment
 * "shifting" or "not moving" as text was typed elsewhere. Only a genuinely
 * *new* comment (no existing decoration yet) falls back to its stored
 * offsets, since it hasn't had a chance to drift from anything yet. Each
 * decoration carries the originating comment's `id` in its spec (CodeMirror
 * preserves arbitrary extra fields on a mark's spec) so a click on the
 * marked text can look up *which* comment it belongs to — see
 * `findCommentAnchorAt`. */
export function computeCommentAnchorDecorations(
  anchors: CommentAnchor[],
  docLength: number,
  currentDecorations: DecorationSet = Decoration.none,
): DecorationSet {
  const livePositionByCommentId = new Map<string, { from: number; to: number }>();
  currentDecorations.between(0, docLength, (from, to, deco) => {
    const id = (deco.spec as { commentId?: string }).commentId;
    if (id) livePositionByCommentId.set(id, { from, to });
  });

  const marks = anchors
    .map((a) => {
      const live = livePositionByCommentId.get(a.id);
      const from = live?.from ?? a.from;
      const to = live?.to ?? a.to;
      return { id: a.id, from: Math.max(0, Math.min(from, docLength)), to: Math.max(0, Math.min(to, docLength)), resolved: a.resolved };
    })
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
