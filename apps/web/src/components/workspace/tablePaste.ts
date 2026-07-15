/** Paste a table copied from Excel/Word as a real, formatted LaTeX
 * `tabular` — same "paste rich content, get real LaTeX" idea already
 * shipped for BibTeX (citeCompletion.ts's paste path). Reuses
 * tableDesigner.ts's TableGridModel/serializeTabular for output, so a
 * pasted table is immediately a normal, editable `tabular` block (the
 * Table Designer gutter icon picks it up right away).
 *
 * Excel/Word both populate `text/html` on copy with a real `<table>`
 * fragment carrying the formatting the plain-text clipboard entry throws
 * away. No real Office app is available to capture a live sample from in
 * this environment — this is grounded in Excel/Word's well-documented,
 * long-stable clipboard HTML conventions (semantic tags plus
 * `style="font-weight:bold"`-style inline styles, `colspan`/`rowspan`
 * attributes) rather than a captured sample. Same "best-effort, not a
 * real parser" discipline as tableDesigner.ts itself: a cell can't be
 * both colspan and rowspan at once (matching TableGridModel's own
 * documented scope limit — colspan wins, rowspan is dropped), and a
 * cell's internal line breaks collapse to a single space rather than a
 * literal `\\`, which inside a plain `tabular` cell is a row separator,
 * not a line break, and would corrupt the table structure. */

import type { ColumnAlign, TableCell, TableColumn, TableGridModel } from "./tableDesigner";

export function looksLikeHtmlTable(html: string): boolean {
  return /<table[\s>]/i.test(html);
}

const ESCAPE_RE = /[\\{}$&#%_~^]/g;
const ESCAPE_MAP: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  "%": "\\%",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

function escapeLatexText(s: string): string {
  return s.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}

interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function styleContribution(el: Element, state: FormatState): FormatState {
  const tag = el.tagName.toLowerCase();
  const style = (el.getAttribute("style") || "").toLowerCase();
  const bold = state.bold || tag === "b" || tag === "strong" || /font-weight\s*:\s*(bold|[6-9]\d\d)/.test(style);
  const italic = state.italic || tag === "i" || tag === "em" || /font-style\s*:\s*italic/.test(style);
  const underline = state.underline || tag === "u" || /text-decoration\s*:[^;]*underline/.test(style);
  return { bold, italic, underline };
}

function wrap(text: string, state: FormatState): string {
  let out = text;
  if (state.underline) out = `\\underline{${out}}`;
  if (state.italic) out = `\\textit{${out}}`;
  if (state.bold) out = `\\textbf{${out}}`;
  return out;
}

/** Walks a `<td>`/`<th>`'s DOM subtree into a single LaTeX-ready string —
 * exported for standalone testing. Never touches `innerHTML`, only ever
 * reads structure/text, so parsing untrusted clipboard HTML is safe. */
export function htmlCellToLatex(node: Node, state: FormatState = { bold: false, italic: false, underline: false }): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text.trim() === "") return text.replace(/\s+/g, " ");
    return wrap(escapeLatexText(text), state);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return " ";
  if (tag === "script" || tag === "style") return "";
  const nextState = styleContribution(el, state);
  const isBlock = tag === "p" || tag === "div";
  const inner = Array.from(el.childNodes)
    .map((child) => htmlCellToLatex(child, nextState))
    .join("");
  return isBlock ? `${inner} ` : inner;
}

function cellTextAlign(el: Element): ColumnAlign | null {
  const style = (el.getAttribute("style") || "").toLowerCase();
  const styleMatch = /text-align\s*:\s*(left|center|right)/.exec(style);
  const source = styleMatch?.[1] ?? el.getAttribute("align")?.toLowerCase() ?? null;
  if (source === "left") return "l";
  if (source === "center") return "c";
  if (source === "right") return "r";
  return null;
}

interface PendingRowspan {
  remaining: number;
}

/** Parses the first `<table>` in `html` into a `TableGridModel`, or
 * `null` if there's no real tabular data to convert (e.g. a `<table>`
 * used purely for layout). `colspan`/`rowspan` become `multicolumn`/
 * `multirow`/`covered` cells (tableDesigner.ts's existing vocabulary);
 * column alignment is a majority vote across each column's own cells. */
export function parseHtmlTableToGridModel(html: string): TableGridModel | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const trs = Array.from(table.querySelectorAll("tr"));
  if (trs.length === 0) return null;

  const rows: TableCell[][] = [];
  const alignVotes: Record<ColumnAlign, number>[] = [];
  // Tracks, per column index, a rowspan cell from an earlier row that still
  // owes covered placeholder cells in the rows below it.
  const pending = new Map<number, PendingRowspan>();
  let columnCount = 0;

  const consumePending = (row: TableCell[], col: number): number => {
    while (pending.has(col)) {
      row[col] = { kind: "covered", by: "rowspan" };
      const owed = pending.get(col)!;
      owed.remaining--;
      if (owed.remaining <= 0) pending.delete(col);
      col++;
    }
    return col;
  };

  for (const tr of trs) {
    const cellsEls = Array.from(tr.querySelectorAll("td, th"));
    if (cellsEls.length === 0) continue;
    const row: TableCell[] = [];
    let col = 0;

    for (const cellEl of cellsEls) {
      // Skip past any column still covered by an earlier row's rowspan.
      col = consumePending(row, col);

      const text = htmlCellToLatex(cellEl).trim().replace(/\s+/g, " ");
      const colspan = Math.max(1, parseInt(cellEl.getAttribute("colspan") || "1", 10) || 1);
      const rowspan = Math.max(1, parseInt(cellEl.getAttribute("rowspan") || "1", 10) || 1);
      const align = cellTextAlign(cellEl) ?? "l";

      alignVotes[col] = alignVotes[col] ?? { l: 0, c: 0, r: 0 };
      alignVotes[col][align]++;

      if (colspan > 1) {
        // Combining colspan and rowspan on one cell at once is out of scope
        // for TableGridModel itself (see tableDesigner.ts's own docstring)
        // — colspan wins, rowspan is dropped, a documented compromise.
        row[col] = { kind: "multicolumn", text, colspan, align, leftBorder: false, rightBorder: false };
        for (let i = 1; i < colspan; i++) row[col + i] = { kind: "covered", by: "colspan" };
        col += colspan;
      } else if (rowspan > 1) {
        row[col] = { kind: "multirow", text, rowspan, width: "*" };
        pending.set(col, { remaining: rowspan - 1 });
        col += 1;
      } else {
        row[col] = { kind: "text", text };
        col += 1;
      }
    }

    // Trailing columns covered by a pending rowspan beyond this row's own
    // real cells (the covered column sits to the right of everything else
    // in this particular row).
    col = consumePending(row, col);

    columnCount = Math.max(columnCount, col);
    rows.push(row);
  }

  if (columnCount === 0 || rows.length === 0) return null;

  // Every row must have exactly `columnCount` entries.
  for (const row of rows) {
    while (row.length < columnCount) row.push({ kind: "text", text: "" });
  }

  const columns: TableColumn[] = Array.from({ length: columnCount }, (_, i) => {
    const votes = alignVotes[i] ?? { l: 1, c: 0, r: 0 };
    const best = (Object.keys(votes) as ColumnAlign[]).reduce((a, b) => (votes[b] > votes[a] ? b : a), "l" as ColumnAlign);
    return { align: best };
  });

  return {
    widthArg: null,
    columns,
    verticalBorders: Array.from({ length: columnCount + 1 }, () => false),
    rows,
    horizontalBorders: rows.map((_, i) => (i === 0 ? "hline" : false)).concat(["hline"]) as TableGridModel["horizontalBorders"],
    defaultRuleKind: "hline",
  };
}
