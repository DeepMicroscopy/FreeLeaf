import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/** Applies a completion's label as plain text, closing the `{...}` group
 * with `}` unless one is already sitting right after the cursor (e.g.
 * completing the second key in an already-closed `\cite{a, b|}`). */
export function applyAndCloseBrace(view: EditorView, completion: Completion, from: number, to: number): void {
  const afterChar = view.state.sliceDoc(to, to + 1);
  const insert = completion.label + (afterChar === "}" ? "" : "}");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
}
