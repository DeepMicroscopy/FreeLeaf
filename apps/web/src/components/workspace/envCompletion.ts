import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

// Matches while the cursor is inside an unclosed \begin{...}.
const BEGIN_COMMAND_RE = /\\begin\{([a-zA-Z*]*)$/;

const COMMON_ENVIRONMENTS = [
  "document",
  "figure", "figure*",
  "table", "table*",
  "tabular", "tabularx", "longtable",
  "itemize", "enumerate", "description",
  "equation", "equation*",
  "align", "align*",
  "center", "abstract", "quote", "verbatim", "minipage",
];

/** Unlike cite/ref completion (which just insert a key and close the
 * brace), completing an environment name also inserts the matching
 * `\end{name}` and puts the cursor on a blank indented line in between —
 * the standard "complete \begin, get a skeleton" behavior most LaTeX
 * editors have. Only done when there's no `}` immediately after the
 * cursor (a fresh `\begin{` being typed) — if one's already there
 * (editing an existing environment's name), just close/replace the name
 * itself so a matching `\end{}` elsewhere isn't duplicated. */
function applyEnvironment(view: EditorView, completion: Completion, from: number, to: number): void {
  const name = completion.label;
  const afterChar = view.state.sliceDoc(to, to + 1);
  if (afterChar === "}") {
    view.dispatch({ changes: { from, to, insert: name }, selection: { anchor: from + name.length } });
    return;
  }

  const line = view.state.doc.lineAt(from);
  const indentMatch = /^[ \t]*/.exec(line.text);
  const indent = indentMatch ? indentMatch[0] : "";
  const openPart = `${name}}\n${indent}\t`;
  const insert = `${openPart}\n${indent}\\end{${name}}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + openPart.length },
  });
}

export function envCompletionSource() {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(BEGIN_COMMAND_RE);
    if (!match) return null;
    const groups = BEGIN_COMMAND_RE.exec(match.text);
    if (!groups) return null;

    const from = match.to - groups[1].length;

    return {
      from,
      options: COMMON_ENVIRONMENTS.map((name) => ({
        label: name,
        type: "keyword",
        apply: applyEnvironment,
      })),
      filter: true,
    };
  };
}
