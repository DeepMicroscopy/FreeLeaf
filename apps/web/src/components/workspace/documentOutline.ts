/** Best-effort scans of the current `.tex` file for the sidebar's Outline
 * and Figures & Tables tabs (Plan.md §9 Phase 11) — same "regex/brace-aware
 * scan, not a full LaTeX parser" discipline as the rest of the editor
 * tooling (tableDesigner.ts, polishingLint.ts): good enough to navigate a
 * real document, not a guarantee of parsing every possible construct.
 */

export interface OutlineEntry {
  /** 0 = \part, 1 = \chapter, 2 = \section, 3 = \subsection, 4 = \subsubsection. */
  level: number;
  title: string;
  line: number;
}

export interface FigureTableEntry {
  kind: "figure" | "table";
  /** The environment's `\caption{...}` text, if it has one. */
  caption: string | null;
  /** A short plain-text snippet of the environment's body, used when there's no caption. */
  snippet: string;
  line: number;
}

function findMatchingBrace(text: string, openIndex: number): number | null {
  if (text[openIndex] !== "{") return null;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

const HEADING_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};
const HEADING_RE = /\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\{/g;

export function parseOutline(text: string): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_RE.exec(text))) {
    const openBrace = m.index + m[0].length - 1;
    const close = findMatchingBrace(text, openBrace);
    if (close === null) continue;
    const title = text.slice(openBrace + 1, close).trim();
    if (title) entries.push({ level: HEADING_LEVELS[m[1]], title, line: lineAt(text, m.index) });
  }
  return entries;
}

const FIGURE_TABLE_RE = /\\begin\{(figure\*?|table\*?)\}/g;
const CAPTION_RE = /\\caption\*?\s*(?:\[[^\]]*\])?\{/;

export function parseFiguresAndTables(text: string): FigureTableEntry[] {
  const entries: FigureTableEntry[] = [];
  FIGURE_TABLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FIGURE_TABLE_RE.exec(text))) {
    const envName = m[1];
    const kind: "figure" | "table" = envName.startsWith("figure") ? "figure" : "table";
    const afterBegin = m.index + m[0].length;
    const endRe = new RegExp(`\\\\end\\{${envName.replace("*", "\\*")}\\}`);
    const endMatch = endRe.exec(text.slice(afterBegin));
    const envEnd = endMatch ? afterBegin + endMatch.index : text.length;
    const body = text.slice(afterBegin, envEnd);

    let caption: string | null = null;
    const capMatch = CAPTION_RE.exec(body);
    if (capMatch) {
      const openBrace = capMatch.index + capMatch[0].length - 1;
      const close = findMatchingBrace(body, openBrace);
      if (close !== null) caption = body.slice(openBrace + 1, close).trim().replace(/\s+/g, " ");
    }

    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 80);
    entries.push({ kind, caption, snippet, line: lineAt(text, m.index) });

    // Resume scanning right after this environment — nested figure/table
    // environments aren't valid LaTeX anyway, and this avoids matching
    // \begin{figure}-lookalike text that happens to appear inside a
    // caption or body (e.g. a code listing quoting LaTeX source).
    FIGURE_TABLE_RE.lastIndex = envEnd;
  }
  return entries;
}
