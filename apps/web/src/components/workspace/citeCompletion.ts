import type { BibEntry } from "@freeleaf/shared";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { applyAndCloseBrace } from "./completionUtils";

// Matches while the cursor is inside an unclosed \cite{...} (or a variant
// command), capturing everything typed so far inside the braces so we can
// find the *current* comma-separated key (supports `\cite{a, b|}`).
const CITE_COMMAND_RE = /\\(?:cite|citep|citet|parencite|autocite|textcite)\{([^{}]*)$/;

export function citeCompletionSource(getEntries: () => BibEntry[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(CITE_COMMAND_RE);
    if (!match) return null;
    const groups = CITE_COMMAND_RE.exec(match.text);
    if (!groups) return null;

    const inner = groups[1];
    const segment = inner.slice(inner.lastIndexOf(",") + 1);
    const trimmed = segment.replace(/^\s+/, "");
    const from = match.to - trimmed.length;

    const entries = getEntries();
    if (entries.length === 0) return null;

    return {
      from,
      options: entries.map((entry) => ({
        label: entry.key,
        detail: [entry.fields.title, entry.fields.author].filter(Boolean).join(" — ").slice(0, 70),
        type: "text",
        apply: applyAndCloseBrace,
      })),
      filter: true,
    };
  };
}
