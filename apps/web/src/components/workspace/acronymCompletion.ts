import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { applyAndCloseBrace } from "./completionUtils";

// Matches while the cursor is inside an unclosed \ac{...} (or a variant
// command from the `acronym` package) — same shape as citeCompletion.ts's
// CITE_COMMAND_RE. Deliberately excludes `\acro{...}` itself (that's the
// *definition* command, not a usage site).
const ACRONYM_COMMAND_RE =
  /\\(?:ac|Ac|acp|Acp|acf|Acf|acfp|Acfp|acs|Acs|acsp|Acsp|acl|Acl|aclp|Aclp|iac|Iac)\{([^{}]*)$/;

const ACRONYM_ENV_RE = /\\begin\{acronym\}/;
// `\acro{key}[short]{long}` — the `[short]` group is optional (defaults to
// `key` itself per the `acronym` package's own semantics).
const ACRO_DEF_RE = /\\acro\{([^}]+)\}(?:\[([^\]]*)\])?\{([^}]*)\}/g;

export interface AcronymInfo {
  key: string;
  short: string;
  long: string;
}

export function hasAcronymBlock(text: string): boolean {
  return ACRONYM_ENV_RE.test(text);
}

/** The `acronym` package builds internal macro names from the key via
 * `\csname acro@<key>\endcsname` — that's a pure-expansion context, and
 * escaped-symbol commands like `\&`/`\%` don't survive it (verified against
 * a real sandbox compile: they produce "Missing \endcsname inserted" and an
 * undefined-acronym error), even though they're perfectly fine as *display*
 * text via `\acro{key}[display]{long}`'s optional argument. So the key must
 * be reduced to plain alphanumerics; anything else the user typed becomes
 * the bracketed display form instead (see CodeMirrorEditor's
 * applyNewAcronymEntry). Falls back to "acro" if nothing alphanumeric is
 * left (e.g. a key typed as just "%"). */
export function sanitizeAcronymKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "") || "acro";
}

/** Best-effort scan for `\acro{...}` definitions anywhere in the file — same
 * "not a real parser" scope as extractLabels/extractAcronyms's siblings:
 * doesn't verify they sit inside a `\begin{acronym}` block, doesn't handle
 * nested braces in the long-form text. */
export function extractAcronyms(text: string): AcronymInfo[] {
  const acronyms: AcronymInfo[] = [];
  ACRO_DEF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACRO_DEF_RE.exec(text))) {
    acronyms.push({ key: m[1], short: m[2] || m[1], long: m[3] });
  }
  return acronyms;
}

/** `onCreateNew` is invoked (instead of any text being inserted) when the
 * user picks the "+ New acronym…" entry — `from`/`to` are the exact range of
 * the in-progress `\ac{...` the completion was triggered from, so the caller
 * can later drop the finished `\ac{key}` in exactly that spot. */
export function acronymCompletionSource(
  getAcronyms: () => AcronymInfo[],
  onCreateNew: (prefillKey: string, from: number, to: number) => void,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(ACRONYM_COMMAND_RE);
    if (!match) return null;
    const groups = ACRONYM_COMMAND_RE.exec(match.text);
    if (!groups) return null;

    const typed = groups[1];
    const from = match.to - typed.length;
    const to = match.to;

    const acronyms = getAcronyms();
    const options: Completion[] = acronyms.map((a) => ({
      label: a.key,
      detail: a.long,
      type: "text",
      apply: applyAndCloseBrace,
    }));
    options.push({
      label: "+ New acronym…",
      detail: acronyms.length === 0 ? "No acronym list yet — creates one" : undefined,
      type: "keyword",
      boost: 99,
      apply: () => onCreateNew(typed, from, to),
    });

    return { from, options, filter: true };
  };
}
