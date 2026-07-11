import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

import type { LintFinding } from "./polishingLint";

export const setPolishingLintDecorations = StateEffect.define<DecorationSet>();

export const polishingLintField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setPolishingLintDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function computePolishingLintDecorations(findings: LintFinding[], docLength: number): DecorationSet {
  const decorations = findings
    .filter((f) => f.from >= 0 && f.to <= docLength && f.from < f.to)
    .map((f) => Decoration.mark({ class: "cm-lintFinding", attributes: { title: f.message } }).range(f.from, f.to));
  return Decoration.set(decorations, true);
}
