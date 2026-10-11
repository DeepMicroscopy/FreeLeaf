/** Whole-document brace-balance check, used to hold off auto-compiling
 * while a `{`/`}` is still unclosed — that's guaranteed to fail and just
 * surfaces a confusing compile error mid-keystroke (see CodeMirrorEditor.tsx's
 * debounced auto-compile trigger). Same "best-effort, not a real LaTeX
 * parser" discipline as polishingLint.ts/tableDesigner.ts: skips `%`
 * comments (running to end of line) and escaped `\{`/`\}` (literal
 * characters, not real grouping), but doesn't special-case verbatim/
 * lstlisting content — a code listing with its own brace syntax is a rare
 * enough case to accept as a known limitation rather than build a real
 * environment-aware parser for. */
export function isBraceBalanced(text: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    // `\\` (LaTeX's line-break command) is a complete two-character unit —
    // the backslash doesn't escape whatever comes right after it, unlike
    // `\{`/`\}`/`\%` below. Without this check first, `\\{` (a line break
    // immediately followed by a real, meaningful brace) would be
    // misread as an escaped, literal `{`.
    if (ch === "\\" && text[i + 1] === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\\" && (text[i + 1] === "{" || text[i + 1] === "}" || text[i + 1] === "%")) {
      i += 2;
      continue;
    }
    if (ch === "%") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return false; // a stray closing brace is unbalanced too
    }
    i++;
  }
  return depth === 0;
}
