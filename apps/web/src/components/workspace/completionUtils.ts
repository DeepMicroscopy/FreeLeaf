import type { Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

/** Applies a completion's label as plain text, closing the `{...}` group
 * with `}` unless one is already sitting right after the cursor (e.g.
 * completing the second key in an already-closed `\cite{a, b|}`).
 *
 * `userEvent: "input.complete"` matters beyond labeling: CodeMirror's own
 * `apply`-as-function path (unlike its string-`apply` fallback) dispatches
 * with no `userEvent` at all, and `suggestionRewrite.ts`'s `isSuggestableEdit`
 * only routes `input`/`delete`-tagged transactions through Reviewing mode's
 * suggestion formatting — so without this, every completion silently wrote
 * straight into the shared document in Reviewing mode instead of becoming a
 * reviewable suggestion (no underline, nothing to accept/reject). */
export function applyAndCloseBrace(view: EditorView, completion: Completion, from: number, to: number): void {
  const afterChar = view.state.sliceDoc(to, to + 1);
  const insert = completion.label + (afterChar === "}" ? "" : "}");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.complete",
  });
}
