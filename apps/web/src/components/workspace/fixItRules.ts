/** Pattern-matched fix suggestions for common, mechanically-fixable compile
 * errors — deliberately not LLM-based, just a curated table of regexes and
 * lookups, same "best-effort, not a real parser" philosophy as
 * tableDesigner.ts/polishingLint.ts/documentOutline.ts. Rules are grounded
 * in real sandbox-compiled log output (see the fix-it-assistant plan), not
 * guessed error wording. */

export interface Diagnostic {
  message: string;
  file?: string | null;
  line?: number | null;
}

export type FixCandidate =
  | { kind: "add-package"; package: string; commandOrEnv: string }
  | { kind: "missing-file"; filename: string; fatal: boolean }
  | { kind: "duplicate-label"; label: string }
  | { kind: "unescaped-ampersand"; line: number };

/** Undefined-control-sequence commands that are provided by exactly one
 * common package — deliberately excludes `\multicolumn` (confirmed via a
 * real sandbox compile to be a core LaTeX command, no package needed, even
 * though it's easy to assume it's package-gated like `\multirow` is). */
const COMMAND_TO_PACKAGE: Record<string, string> = {
  toprule: "booktabs",
  midrule: "booktabs",
  bottomrule: "booktabs",
  multirow: "multirow",
  SI: "siunitx",
  si: "siunitx",
  num: "siunitx",
  cref: "cleveref",
  Cref: "cleveref",
  href: "hyperref",
  enquote: "csquotes",
  thead: "makecell",
  ac: "acronym",
  acro: "acronym",
  acf: "acronym",
  acs: "acronym",
  acl: "acronym",
  lipsum: "lipsum",
  includegraphics: "graphicx",
  textcolor: "xcolor",
  colorbox: "xcolor",
  citep: "natbib",
  citet: "natbib",
  citeauthor: "natbib",
  parencite: "biblatex",
  textcite: "biblatex",
  autocite: "biblatex",
  todo: "todonotes",
};

const ENVIRONMENT_TO_PACKAGE: Record<string, string> = {
  tabularx: "tabularx",
  longtable: "longtable",
  tikzpicture: "tikz",
  axis: "pgfplots",
  align: "amsmath",
  "align*": "amsmath",
  gather: "amsmath",
  "gather*": "amsmath",
  multline: "amsmath",
  "multline*": "amsmath",
  lstlisting: "listings",
  acronym: "acronym",
};

const UNDEFINED_COMMAND_RE = /^Undefined control sequence: \\(\S+)/;
const UNDEFINED_ENV_RE = /^Environment (\S+) undefined\.?/;
const FILE_NOT_FOUND_RE = /File `([^']+)' not found/;
const DUPLICATE_LABEL_RE = /Label `([^']+)' multiply defined/;
// Verified via a real sandbox compile: `This is Blubber & co` outside any
// tabular/align-like environment produces this exact, self-contained error
// (no separate command-name extraction needed, unlike "Undefined control
// sequence.") — recoverable, the compile still produces a PDF.
const MISPLACED_AMPERSAND_RE = /^Misplaced alignment tab character &\.?/;

function candidateKey(c: FixCandidate): string {
  switch (c.kind) {
    case "add-package":
      return `add-package:${c.package}`;
    case "missing-file":
      return `missing-file:${c.filename}`;
    case "duplicate-label":
      return `duplicate-label:${c.label}`;
    case "unescaped-ampersand":
      return `unescaped-ampersand:${c.line}`;
  }
}

/** `hasPdf` (the compile run's own `has_pdf` flag) decides "fatal" for a
 * missing-file match, not which list (errors/warnings) it was found in —
 * a missing `\includegraphics` file is reported as *both* a LaTeX Warning
 * *and* a "! Package pdftex.def Error" (starts with `!`, so log_parser
 * buckets it as an error), yet a PDF still comes out (a draft placeholder
 * box is substituted); a missing `\input` file, by contrast, genuinely
 * halts the compile with no PDF at all. Only the run's actual output tells
 * the two apart. */
export function matchFixes(errors: Diagnostic[], warnings: Diagnostic[], hasPdf: boolean): FixCandidate[] {
  const candidates: FixCandidate[] = [];

  for (const d of errors) {
    const cmdMatch = UNDEFINED_COMMAND_RE.exec(d.message);
    if (cmdMatch) {
      const pkg = COMMAND_TO_PACKAGE[cmdMatch[1]];
      if (pkg) candidates.push({ kind: "add-package", package: pkg, commandOrEnv: `\\${cmdMatch[1]}` });
      continue;
    }
    const envMatch = UNDEFINED_ENV_RE.exec(d.message);
    if (envMatch) {
      const pkg = ENVIRONMENT_TO_PACKAGE[envMatch[1]];
      if (pkg) candidates.push({ kind: "add-package", package: pkg, commandOrEnv: envMatch[1] });
      continue;
    }
    if (MISPLACED_AMPERSAND_RE.test(d.message) && d.line != null) {
      candidates.push({ kind: "unescaped-ampersand", line: d.line });
      continue;
    }
  }

  for (const d of [...errors, ...warnings]) {
    const fileMatch = FILE_NOT_FOUND_RE.exec(d.message);
    if (fileMatch) {
      candidates.push({ kind: "missing-file", filename: fileMatch[1], fatal: !hasPdf });
      continue;
    }
    const labelMatch = DUPLICATE_LABEL_RE.exec(d.message);
    if (labelMatch) {
      candidates.push({ kind: "duplicate-label", label: labelMatch[1] });
      continue;
    }
  }

  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = candidateKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
