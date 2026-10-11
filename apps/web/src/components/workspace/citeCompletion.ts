import type { BibEntry } from "@freeleaf/shared";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { applyAndCloseBrace } from "./completionUtils";

// Matches while the cursor is inside an unclosed \cite{...} (or a variant
// command), capturing everything typed so far inside the braces so we can
// find the *current* comma-separated key (supports `\cite{a, b|}`).
const CITE_COMMAND_RE = /\\(?:cite|citep|citet|parencite|autocite|textcite)\{([^{}]*)$/;

// Same command set as CITE_COMMAND_RE above, but matches a full, already-
// closed `\cite{...}`-family command (optionally preceded by [prenote]/
// [postnote] args, e.g. `\cite[p.~12]{key}`) — for scanning documents that
// already exist, rather than autocomplete-in-progress text.
const CITE_USAGE_RE = /\\(?:cite\w*|parencite|autocite|textcite)(?:\[[^\]]*\])*\{([^{}]*)\}/g;

export interface CiteKeyOccurrence {
  from: number;
  to: number;
}

/** Every exact-key occurrence of `key` inside any `\cite{...}`-family
 * command in `text`, including ones sharing a comma-separated group with
 * other keys (`\cite{a, key, b}`) — used to find and rewrite usages when a
 * cite key is renamed in the Library (see lib/citeKeyRename.ts). Same
 * "best-effort, not a real parser" scope as this codebase's other
 * scanners: doesn't look inside \input/\include'd files (the caller scans
 * each project file itself) and doesn't skip a key that happens to sit
 * inside a comment. */
export function findCiteKeyOccurrences(text: string, key: string): CiteKeyOccurrence[] {
  const occurrences: CiteKeyOccurrence[] = [];
  for (const match of text.matchAll(CITE_USAGE_RE)) {
    const keysArg = match[1];
    // The regex always ends in `{<keysArg>}`, so keysArg sits immediately
    // before the match's trailing `}` — exact, unlike searching for it as
    // a substring (which could spuriously match inside an optional [...]).
    const argStart = match.index! + match[0].length - 1 - keysArg.length;
    let pos = 0;
    for (const part of keysArg.split(",")) {
      const trimmed = part.trim();
      if (trimmed === key) {
        const leadingWs = part.length - part.trimStart().length;
        const from = argStart + pos + leadingWs;
        occurrences.push({ from, to: from + trimmed.length });
      }
      pos += part.length + 1; // +1 for the comma consumed by split()
    }
  }
  return occurrences;
}

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
