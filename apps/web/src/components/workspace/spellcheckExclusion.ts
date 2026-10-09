/** English spell-checking is the browser's own native spell-checker
 * (`spellcheck="true"` on the editor's content DOM, set in
 * CodeMirrorEditor.tsx) — not a bundled dictionary or a server call, so
 * there's nothing here to configure a word list for. The actual work is
 * keeping it USABLE on a LaTeX document: a bare browser spell-checker
 * would flag every command name, math variable, and file path as a
 * misspelling. This marks all of that non-prose text `spellcheck="false"`
 * so only running prose gets checked.
 *
 * Primary source: the `@codemirror/legacy-modes/mode/stex` syntax tree
 * already built for syntax highlighting (latexHighlight.ts) — covers
 * command names, comments, math delimiters/content, and the handful of
 * commands stex.js special-cases (`\cite`, `\ref`, `\label`,
 * `\usepackage`, `\begin`/`\end`, ...). The node names checked below are
 * NOT the raw token styles stex.js returns — `@codemirror/language`'s
 * `StreamLanguage` TokenTable silently remaps some of them (e.g. stex's
 * "tag" token becomes a node named "tagName"), verified against the
 * installed `@codemirror/language` source, not assumed. Same token set
 * latexHighlight.ts colors.
 *
 * Supplementary source: stex.js does NOT give a few common commands'
 * arguments a distinct tag (`\includegraphics{}`, `\href{}`, `\url{}`,
 * ...) — their argument text is indistinguishable from prose in the
 * syntax tree, so it's caught with a small, deliberately narrow regex
 * instead (no nested-brace handling — these arguments are file
 * paths/URLs/keys, which don't contain braces in practice). */

import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

const NON_PROSE_NODE_NAMES = new Set([
  "tagName", // \section, \cite, \includegraphics, ...
  "atom", // \begin{name} / \usepackage{name} argument
  "string", // \importmodule{...} args (sTeX-only, rarely seen)
  "variableName.standard", // "builtin" token, if ever emitted
  "comment", // % ...
  "bracket", // { } [ ]
  "keyword", // $ \( \) \[ \]  math delimiters
  "variableName.special", // bare words inside math
  "number", // numbers inside math
  "invalid", // unrecognized math-mode content
]);

// Commands whose argument is an identifier/path/URL, not prose, but which
// stex.js's DEFAULT token plugin doesn't tag distinctly (unlike \cite,
// \ref, \label, \usepackage, \begin/\end, which the syntax tree already
// covers above).
const UNTAGGED_IDENTIFIER_ARG_RE =
  /\\(includegraphics|href|url|input|include|bibliography|bibliographystyle|textcite|parencite|autocite|pageref|nameref|Cref)\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g;

interface Range {
  from: number;
  to: number;
}

function computeExclusionRanges(state: EditorState): Range[] {
  const ranges: Range[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (NON_PROSE_NODE_NAMES.has(node.type.name) && node.to > node.from) {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });

  const text = state.doc.toString();
  for (const match of text.matchAll(UNTAGGED_IDENTIFIER_ARG_RE)) {
    const arg = match[2];
    if (arg.length === 0) continue;
    // The regex always ends in `{<arg>}`, so the argument sits immediately
    // before the match's trailing `}` — exact, unlike searching for `arg`
    // as a substring (which could spuriously match inside the optional
    // `[...]` part first).
    const argStart = match.index! + match[0].length - 1 - arg.length;
    ranges.push({ from: argStart, to: argStart + arg.length });
  }

  return ranges;
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations = computeExclusionRanges(view.state).map((r) =>
    Decoration.mark({ attributes: { spellcheck: "false" } }).range(r.from, r.to),
  );
  return Decoration.set(decorations, true);
}

/** Recomputes on every document change — cheap, since it's just walking
 * the syntax tree CodeMirror already maintains for highlighting, plus one
 * narrow regex pass; no debouncing needed (unlike polishingLint.ts's
 * heavier full-text scan). */
export const spellcheckExclusion = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = buildDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);
