import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { applyAndCloseBrace } from "./completionUtils";

// Matches while the cursor is inside \includegraphics's filename argument,
// with or without a preceding [options] group — same shape as
// citeCompletion.ts's CITE_COMMAND_RE.
const FILE_ARG_RE = /\\includegraphics(?:\[[^\]]*\])?\{([^{}]*)$/;

// Matches while the cursor is inside \includegraphics's [options] group,
// before the closing `]` — comma-aware so `[width=1.0, |]` still completes.
const OPTIONS_RE = /\\includegraphics\[([^\]]*)$/;

// graphicx's most commonly used keys — covers the common case, not the
// package's full option surface (same "best-effort" scope as the rest of
// this editor's completion sources).
const OPTION_KEYS = ["width", "height", "scale", "angle", "trim", "clip", "keepaspectratio", "page", "viewport"];

function applyOptionKey(view: EditorView, completion: Completion, from: number, to: number): void {
  const insert = `${completion.label}=`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
}

export function includegraphicsFileCompletionSource(getImagePaths: () => string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(FILE_ARG_RE);
    if (!match) return null;
    const groups = FILE_ARG_RE.exec(match.text);
    if (!groups) return null;

    const trimmed = groups[1];
    const from = match.to - trimmed.length;

    const paths = getImagePaths();
    if (paths.length === 0) return null;

    return {
      from,
      options: paths.map((path) => ({ label: path, type: "text", apply: applyAndCloseBrace })),
      filter: true,
    };
  };
}

export function includegraphicsOptionsCompletionSource() {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(OPTIONS_RE);
    if (!match) return null;
    const groups = OPTIONS_RE.exec(match.text);
    if (!groups) return null;

    const inner = groups[1];
    const segment = inner.slice(inner.lastIndexOf(",") + 1);
    const trimmed = segment.replace(/^\s+/, "");
    const from = match.to - trimmed.length;

    return {
      from,
      options: OPTION_KEYS.map((key) => ({ label: key, type: "keyword", apply: applyOptionKey })),
      filter: true,
    };
  };
}
