/** Polishing mode's static checks (Plan.md §9 Phase 8): "detecting missing
 * non-breaking spaces ~ before citations, orphaned headings, or unescaped
 * symbols." This is a best-effort scanner, not a real LaTeX parser — same
 * "best-effort, not a real parser" trade-off as log_parser.py's file
 * tracking. In particular:
 *  - Math-mode tracking only recognizes inline `$...$` (simple toggle, not
 *    `$$`) and a fixed list of common math environments/`\[...\]` — enough
 *    to avoid flagging `_`/`^` inside normal math, not a full parser.
 *  - `$` itself is deliberately NOT checked for escaping: a document with
 *    literal currency signs and one with genuine math both produce dollar
 *    signs the compiler itself already validates far better than a static
 *    scanner could (unbalanced math delimiters are compile errors anyway).
 *  - `%` starts a genuine LaTeX comment when unescaped, so most unescaped
 *    `%` are *intentional* — only flagged when immediately preceded by a
 *    digit ("50%"), the one case that's overwhelmingly a forgotten escape
 *    rather than a real comment. Still always treated as the comment
 *    boundary for the rest of the line either way, matching real LaTeX.
 *  - "Orphaned heading" means "no body content before the next heading or
 *    end of document" — a document-structure proxy, not real page-layout
 *    analysis (which would need the rendered PDF, not just the source).
 *  - The symbol checks skip the *argument* of identifier-taking commands
 *    (`\cite{...}`, `\ref{...}`, `\label{...}`, `\includegraphics{...}`,
 *    `\href{url}{...}`, etc.) — a citation key like `smith_2020` or a path
 *    like `fig_1.png` isn't prose, and underscores/etc. there are normal,
 *    not typos. Only the first `{...}` group after the command is skipped
 *    (so `\href{url_with_underscore}{normal prose}`'s second argument is
 *    still checked).
 */

export interface LintFinding {
  line: number;
  from: number;
  to: number;
  message: string;
}

const SECTIONING_RE = /^\\(chapter|section|subsection|subsubsection|paragraph)\*?\{/;
const LABEL_RE = /^\\label\{/;
const CITE_RE = /\\(cite\w*|parencite|autocite|textcite|ref|eqref|[Cc]ref)\{/g;

const MATH_ENV_NAMES = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*",
  "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*",
  "math", "displaymath",
]);
const AMPERSAND_ENV_NAMES = new Set([
  "tabular", "tabular*", "tabularx", "array", "matrix", "pmatrix", "bmatrix",
  "vmatrix", "Vmatrix", "align", "align*", "alignat", "alignat*", "longtable",
]);

// Commands whose (first) argument is an identifier/path/URL, not prose —
// symbol checks (_, ^, &, #) don't apply inside it. Only the first `{...}`
// group is skipped, so e.g. \href's second (prose) argument still is.
const IDENTIFIER_ARG_RE =
  /\\(cite\w*|parencite|autocite|textcite|ref|eqref|pageref|nameref|[Cc]ref|label|includegraphics|input|include|usepackage|documentclass|bibliography|bibliographystyle|href|url)\*?(\[[^\]]*\])?\{/g;

function findIdentifierArgRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  IDENTIFIER_ARG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENTIFIER_ARG_RE.exec(line))) {
    const braceStart = m.index + m[0].length;
    const closeIdx = line.indexOf("}", braceStart);
    if (closeIdx !== -1) ranges.push([braceStart, closeIdx]);
  }
  return ranges;
}

function isExcluded(ranges: Array<[number, number]>, pos: number): boolean {
  return ranges.some(([s, e]) => pos >= s && pos < e);
}

function findCommentIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "%" && line[i - 1] !== "\\") return i;
  }
  return -1;
}

function stripComment(line: string): string {
  const idx = findCommentIndex(line);
  return idx === -1 ? line : line.slice(0, idx);
}

export function lintLatex(text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = text.split("\n");

  let inMath = false;
  const envStack: string[] = [];
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const commentIdx = findCommentIndex(rawLine);
    const line = commentIdx === -1 ? rawLine : rawLine.slice(0, commentIdx);
    const lineNo = lineIdx + 1;

    if (commentIdx > 0 && /[0-9]/.test(rawLine[commentIdx - 1])) {
      findings.push({
        line: lineNo, from: offset + commentIdx, to: offset + commentIdx + 1,
        message: "Unescaped '%' after a digit — did you mean '\\%'? (Everything after it is treated as a comment.)",
      });
    }

    // \begin{X} / \end{X} tracking, and orphaned-heading detection.
    const beginMatch = line.match(/\\begin\{([^}]+)\}/);
    if (beginMatch) {
      envStack.push(beginMatch[1]);
      if (MATH_ENV_NAMES.has(beginMatch[1])) inMath = true;
    }
    const endMatch = line.match(/\\end\{([^}]+)\}/);
    if (endMatch) {
      const popped = envStack.pop();
      if (popped && MATH_ENV_NAMES.has(popped)) inMath = false;
    }

    const trimmed = line.trim();
    if (SECTIONING_RE.test(trimmed)) {
      let j = lineIdx + 1;
      while (j < lines.length) {
        const nextTrimmed = stripComment(lines[j]).trim();
        if (nextTrimmed === "" || LABEL_RE.test(nextTrimmed)) {
          j++;
          continue;
        }
        if (SECTIONING_RE.test(nextTrimmed) || nextTrimmed.startsWith("\\end{document}")) {
          findings.push({
            line: lineNo,
            from: offset,
            to: offset + rawLine.length,
            message: "Orphaned heading — no content before the next heading or the end of the document.",
          });
        }
        break;
      }
    }

    // Inline math toggle and per-character unescaped-symbol checks.
    const identifierRanges = findIdentifierArgRanges(line);
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const escaped = line[i - 1] === "\\";
      if (ch === "$" && !escaped) {
        inMath = !inMath;
        continue;
      }
      if (escaped) continue;
      if (isExcluded(identifierRanges, i)) continue;

      if (ch === "&") {
        const top = envStack[envStack.length - 1];
        if (!top || !AMPERSAND_ENV_NAMES.has(top)) {
          findings.push({
            line: lineNo, from: offset + i, to: offset + i + 1,
            message: "Unescaped '&' outside a tabular/align-like environment — did you mean '\\&'?",
          });
        }
      } else if (ch === "#") {
        const next = line[i + 1];
        if (!(next >= "0" && next <= "9")) {
          findings.push({
            line: lineNo, from: offset + i, to: offset + i + 1,
            message: "Unescaped '#' — did you mean '\\#'?",
          });
        }
      } else if ((ch === "_" || ch === "^") && !inMath) {
        findings.push({
          line: lineNo, from: offset + i, to: offset + i + 1,
          message: `Unescaped '${ch}' outside math mode — did you mean '\\${ch === "_" ? "_" : "^{}"}'?`,
        });
      }
    }

    offset += rawLine.length + 1;
  }

  // Missing `~` before citation/reference commands: "word \cite{" should be
  // "word~\cite{" so a line break can't separate the reference from its
  // context.
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITE_RE.exec(text))) {
    const start = match.index;
    if (start >= 2 && text[start - 1] === " " && /\w/.test(text[start - 2])) {
      const lineNo = text.slice(0, start).split("\n").length;
      findings.push({
        line: lineNo,
        from: start - 1,
        to: start,
        message: "Use '~' instead of a space before this reference, to keep it from being separated by a line break.",
      });
    }
  }

  findings.sort((a, b) => a.from - b.from);
  return findings;
}
