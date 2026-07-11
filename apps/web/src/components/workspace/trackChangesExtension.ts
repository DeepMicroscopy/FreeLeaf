import { diffLines } from "diff";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

// Reviewing mode's track-changes markup (Plan.md §9 Phase 8): rather than a
// live per-keystroke CRDT-attributed "suggestion" layer — a much bigger,
// riskier undertaking on top of Yjs — this diffs the file's current live
// content against a chosen snapshot baseline (reusing the same `diffLines`
// already used for the Time Travel diff view) and renders the result as
// inline decorations in the *same* editable document: insertions get a
// green mark over the live text (still just normal, editable text
// underneath); deletions don't exist in the live document any more, so
// they're rendered as non-editable widgets showing the removed text with
// strikethrough, positioned exactly where they used to be.
export const setTrackChangesDecorations = StateEffect.define<DecorationSet>();

export const trackChangesField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setTrackChangesDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class RemovedTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: RemovedTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-trackDelete";
    span.textContent = this.text;
    return span;
  }
}

/** Computes decorations by walking `diffLines(baselineText, currentText)`
 * hunk by hunk, tracking a running position in `currentText` — unchanged
 * and added hunks advance that position (their text is really there in the
 * live doc); removed hunks don't (their text is only in the baseline), so
 * they're rendered as a zero-width widget at the position they would have
 * occupied. */
export function computeTrackChangesDecorations(baselineText: string, currentText: string): DecorationSet {
  if (baselineText === currentText) return Decoration.none;
  const parts = diffLines(baselineText, currentText);
  const decorations = [];
  let pos = 0;

  for (const part of parts) {
    if (part.added) {
      const length = part.value.length;
      if (length > 0) decorations.push(Decoration.mark({ class: "cm-trackInsert" }).range(pos, pos + length));
      pos += length;
    } else if (part.removed) {
      if (part.value.length > 0) {
        decorations.push(
          Decoration.widget({ widget: new RemovedTextWidget(part.value), side: -1 }).range(pos),
        );
      }
    } else {
      pos += part.value.length;
    }
  }

  return Decoration.set(decorations, true);
}
