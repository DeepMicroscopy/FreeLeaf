/** Table Designer (Plan.md §9 Phase 10): parses/serializes `tabular`-family
 * LaTeX environments into a plain grid model an interactive UI can edit.
 * Deliberately scoped to the common case, same "best-effort, not a real
 * parser" discipline as log_parser.py/polishingLint.ts — anything using
 * `\cline`, booktabs rules (`\toprule` etc.), a nested environment, a
 * non-l/c/r column type (`p{}`, `m{}`, `@{}`, ...), a mismatched cell count,
 * a doubled `\hline`/`|`, or a cell combining `\multicolumn` *and*
 * `\multirow` at once is reported as *unsupported* rather than silently
 * mangled — the caller should refuse to open the designer and say why, not
 * guess. `\multicolumn` and `\multirow` (used separately) are supported.
 */

export type ColumnAlign = "l" | "c" | "r";

export interface TableColumn {
  align: ColumnAlign;
}

export type TableCell =
  | { kind: "text"; text: string }
  | { kind: "multicolumn"; text: string; colspan: number; align: ColumnAlign; leftBorder: boolean; rightBorder: boolean }
  | { kind: "multirow"; text: string; rowspan: number; width: string }
  /** Occupied by a `multicolumn`/`multirow` cell elsewhere in the grid — not
   * directly editable, and rendered as nothing (the spanning cell's
   * `colSpan`/`rowSpan` covers it). Serialization differs by `by`: a cell
   * covered by a `colspan` has no `&`-slot of its own in the source at all
   * (the multicolumn's own colspan already accounts for it) and is omitted;
   * a cell covered by a `rowspan` still occupies a real (empty) `&`-slot in
   * its row in the source — LaTeX has no way to omit it — so it's
   * serialized as an empty cell. */
  | { kind: "covered"; by: "colspan" | "rowspan" };

export interface TableGridModel {
  /** The `{width}` argument `tabular*`/`tabularx` take before the column
   * spec; null for plain `tabular`/`longtable`. Preserved verbatim, unparsed. */
  widthArg: string | null;
  columns: TableColumn[];
  /** Length columns.length + 1 — one slot before each column and one after the last. */
  verticalBorders: boolean[];
  /** Each row has exactly `columns.length` entries — spanned-over slots are
   * filled with `{kind: "covered"}` so every row/column index pair resolves
   * to exactly one cell, span or not. */
  rows: TableCell[][];
  /** Length rows.length + 1 — one slot before each row and one after the last. */
  horizontalBorders: boolean[];
}

export interface TabularMatch {
  envName: string;
  from: number;
  to: number;
  beginLine: number;
  raw: string;
  supported: boolean;
  reason?: string;
  model?: TableGridModel;
}

const TABULAR_ENV_RE = /\\begin\{(tabular\*?|tabularx|longtable)\}/;
const TABULAR_BEGIN_LINE_RE = /\\begin\{(tabular\*?|tabularx|longtable)\}/;
const UNSUPPORTED_BODY_RE = /\\(cline|toprule|midrule|bottomrule|begin)\b/;

export function lineHasTabularBegin(lineText: string): boolean {
  return TABULAR_BEGIN_LINE_RE.test(lineText);
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

function parseColSpec(spec: string): { columns: TableColumn[]; verticalBorders: boolean[] } | null {
  const columns: TableColumn[] = [];
  const verticalBorders: boolean[] = [];
  let pendingBorder = false;
  for (const ch of spec) {
    if (ch === "|") {
      if (pendingBorder) return null; // doubled "||" — unsupported, don't collapse silently
      pendingBorder = true;
      continue;
    }
    if (ch === "l" || ch === "c" || ch === "r") {
      verticalBorders.push(pendingBorder);
      columns.push({ align: ch });
      pendingBorder = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    return null; // p{}, m{}, @{}, >{...}, etc. — unsupported column type
  }
  verticalBorders.push(pendingBorder);
  return { columns, verticalBorders };
}

/** Reads `count` consecutive `{...}` argument groups starting at `start`
 * (skipping whitespace between them, as LaTeX does), brace-depth-aware. */
function extractBraceGroups(text: string, start: number, count: number): { groups: string[]; end: number } | null {
  let cursor = start;
  const groups: string[] = [];
  for (let i = 0; i < count; i++) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] !== "{") return null;
    const end = findMatchingBrace(text, cursor);
    if (end === null) return null;
    groups.push(text.slice(cursor + 1, end));
    cursor = end + 1;
  }
  return { groups, end: cursor };
}

interface ParsedMulticolumn {
  colspan: number;
  align: ColumnAlign;
  leftBorder: boolean;
  rightBorder: boolean;
  text: string;
}

/** Returns `null` if `cellText` isn't a whole-cell `\multicolumn{...}`
 * (i.e. plain text, possibly mentioning `\multicolumn` later on — left
 * alone), or `"invalid"` if it starts as one but is malformed/uses
 * something out of scope (custom column type, nested `\multirow`, trailing
 * content after the three argument groups). */
function tryParseMulticolumnCell(cellText: string): ParsedMulticolumn | "invalid" | null {
  const trimmed = cellText.trim();
  const MACRO = "\\multicolumn";
  if (!trimmed.startsWith(MACRO)) return null;
  const afterMacroChar = trimmed[MACRO.length];
  if (afterMacroChar !== undefined && afterMacroChar !== "{" && !/\s/.test(afterMacroChar)) return null; // e.g. a hypothetical "\multicolumnfoo"

  const extracted = extractBraceGroups(trimmed, MACRO.length, 3);
  if (!extracted) return "invalid";
  if (trimmed.slice(extracted.end).trim() !== "") return "invalid"; // trailing junk after the 3rd group

  const [nStr, spec, text] = extracted.groups;
  const n = Number.parseInt(nStr.trim(), 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== nStr.trim()) return "invalid";
  const colSpec = parseColSpec(spec);
  if (!colSpec || colSpec.columns.length !== 1) return "invalid";
  if (/\\multirow\b/.test(text)) return "invalid"; // combined colspan+rowspan on one cell: out of scope

  return { colspan: n, align: colSpec.columns[0].align, leftBorder: colSpec.verticalBorders[0], rightBorder: colSpec.verticalBorders[1], text };
}

interface ParsedMultirow {
  rowspan: number;
  width: string;
  text: string;
}

function tryParseMultirowCell(cellText: string): ParsedMultirow | "invalid" | null {
  const trimmed = cellText.trim();
  const MACRO = "\\multirow";
  if (!trimmed.startsWith(MACRO)) return null;
  const afterMacroChar = trimmed[MACRO.length];
  if (afterMacroChar !== undefined && afterMacroChar !== "{" && !/\s/.test(afterMacroChar)) return null;

  const extracted = extractBraceGroups(trimmed, MACRO.length, 3);
  if (!extracted) return "invalid";
  if (trimmed.slice(extracted.end).trim() !== "") return "invalid";

  const [nStr, width, text] = extracted.groups;
  const n = Number.parseInt(nStr.trim(), 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== nStr.trim()) return "invalid";
  if (/\\multicolumn\b/.test(text)) return "invalid"; // combined colspan+rowspan on one cell: out of scope

  return { rowspan: n, width, text };
}

type Token = { kind: "hline" } | { kind: "rowsep" } | { kind: "cellsep" } | { kind: "text"; value: string };

function tokenizeBody(body: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      tokens.push({ kind: "text", value: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "\\") {
      flush();
      tokens.push({ kind: "rowsep" });
      i += 2;
      continue;
    }
    if (ch === "\\" && depth === 0 && body.startsWith("\\hline", i)) {
      flush();
      tokens.push({ kind: "hline" });
      i += 6;
      continue;
    }
    if (ch === "{") {
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "&" && depth === 0) {
      flush();
      tokens.push({ kind: "cellsep" });
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return tokens;
}

/** Groups tokens into raw (un-interpreted) string cells per row — same
 * bookkeeping `buildRows` used to do, minus the column-count check, which
 * now has to happen after `\multicolumn` spans are accounted for. */
function splitIntoRawRows(tokens: Token[]): { ok: true; rawRows: string[][]; horizontalBorders: boolean[] } | { ok: false; reason: string } {
  const rawRows: string[][] = [];
  const horizontalBorders: boolean[] = [];
  let currentCells: string[] = [];
  let cellBuf = "";
  let sawTextInRow = false;
  let pendingHline = false;

  const finalizeCell = () => {
    currentCells.push(cellBuf.trim());
    cellBuf = "";
  };
  const finalizeRow = () => {
    finalizeCell();
    horizontalBorders.push(pendingHline);
    rawRows.push(currentCells);
    currentCells = [];
    pendingHline = false;
    sawTextInRow = false;
  };

  for (const tok of tokens) {
    if (tok.kind === "hline") {
      if (sawTextInRow) return { ok: false, reason: "Found \\hline in the middle of a row." };
      if (pendingHline) return { ok: false, reason: "Doubled \\hline (double rule) isn't supported yet." };
      pendingHline = true;
    } else if (tok.kind === "cellsep") {
      finalizeCell();
    } else if (tok.kind === "rowsep") {
      finalizeRow();
    } else {
      cellBuf += tok.value;
      if (tok.value.trim()) sawTextInRow = true;
    }
  }
  if (cellBuf.trim() || currentCells.length > 0) finalizeRow();
  horizontalBorders.push(pendingHline);

  return { ok: true, rawRows, horizontalBorders };
}

/** Interprets each row's raw cell strings into `TableCell`s, resolving
 * `\multicolumn`/`\multirow` spans into a fixed `columnCount`-wide grid per
 * row. This is where most "unsupported" rejections for spans happen: a
 * `\multicolumn` overflowing the table, a `\multirow` running past the
 * last row, a non-empty cell where an empty `\multirow` placeholder was
 * expected, or a `\multicolumn` overlapping a column still pending a
 * `\multirow` placeholder from an earlier row. */
function interpretGrid(rawRows: string[][], columnCount: number): { ok: true; rows: TableCell[][] } | { ok: false; reason: string } {
  const nRows = rawRows.length;
  const grid: TableCell[][] = Array.from({ length: nRows }, () => new Array(columnCount));
  const pendingMultirow: (number | null)[] = new Array(columnCount).fill(null);

  for (let r = 0; r < nRows; r++) {
    const rawCells = rawRows[r];
    let rawIdx = 0;
    let col = 0;
    while (col < columnCount) {
      if (pendingMultirow[col] !== null) {
        const cellText = rawCells[rawIdx];
        if (cellText === undefined) {
          return { ok: false, reason: `Row ${r + 1} ends before reaching the \\multirow placeholder expected in column ${col + 1}.` };
        }
        if (cellText.trim() !== "") {
          return { ok: false, reason: `Row ${r + 1}, column ${col + 1}: expected an empty placeholder cell under a \\multirow, found content.` };
        }
        grid[r][col] = { kind: "covered", by: "rowspan" };
        pendingMultirow[col] = pendingMultirow[col]! - 1;
        if (pendingMultirow[col] === 0) pendingMultirow[col] = null;
        rawIdx++;
        col++;
        continue;
      }

      const cellText = rawCells[rawIdx];
      if (cellText === undefined) {
        return { ok: false, reason: `Row ${r + 1} has fewer cells than the ${columnCount}-column table expects.` };
      }

      const mc = tryParseMulticolumnCell(cellText);
      if (mc === "invalid") {
        return { ok: false, reason: `Row ${r + 1}: uses \\multicolumn in a way that isn't supported (custom column type, or combined with \\multirow).` };
      }
      if (mc) {
        if (col + mc.colspan > columnCount) {
          return { ok: false, reason: `Row ${r + 1}: \\multicolumn{${mc.colspan}}{...} overflows the ${columnCount}-column table.` };
        }
        for (let k = 1; k < mc.colspan; k++) {
          if (pendingMultirow[col + k] !== null) {
            return { ok: false, reason: `Row ${r + 1}: a \\multicolumn overlaps a column still expecting an empty \\multirow placeholder.` };
          }
        }
        grid[r][col] = { kind: "multicolumn", text: mc.text, colspan: mc.colspan, align: mc.align, leftBorder: mc.leftBorder, rightBorder: mc.rightBorder };
        for (let k = 1; k < mc.colspan; k++) grid[r][col + k] = { kind: "covered", by: "colspan" };
        col += mc.colspan;
        rawIdx++;
        continue;
      }

      const mr = tryParseMultirowCell(cellText);
      if (mr === "invalid") {
        return { ok: false, reason: `Row ${r + 1}: uses \\multirow in a way that isn't supported (combined with \\multicolumn).` };
      }
      if (mr) {
        if (r + mr.rowspan > nRows) {
          return { ok: false, reason: `Row ${r + 1}: \\multirow{${mr.rowspan}}{...} extends past the last row of the table.` };
        }
        grid[r][col] = { kind: "multirow", text: mr.text, rowspan: mr.rowspan, width: mr.width };
        if (mr.rowspan > 1) pendingMultirow[col] = mr.rowspan - 1;
        col++;
        rawIdx++;
        continue;
      }

      grid[r][col] = { kind: "text", text: cellText.trim() };
      col++;
      rawIdx++;
    }
    if (rawIdx !== rawCells.length) {
      return { ok: false, reason: `Row ${r + 1} has more cells than the ${columnCount}-column table expects.` };
    }
  }

  if (pendingMultirow.some((p) => p !== null)) {
    return { ok: false, reason: "A \\multirow extends past the last row of the table." };
  }

  return { ok: true, rows: grid as TableCell[][] };
}

function parseTabular(envName: string, contentAfterBeginName: string): { ok: true; model: TableGridModel } | { ok: false; reason: string } {
  let cursor = 0;
  let widthArg: string | null = null;

  if (envName === "tabular*" || envName === "tabularx") {
    while (/\s/.test(contentAfterBeginName[cursor])) cursor++;
    if (contentAfterBeginName[cursor] !== "{") {
      return { ok: false, reason: `${envName} requires a {width} argument before the column spec.` };
    }
    const widthEnd = findMatchingBrace(contentAfterBeginName, cursor);
    if (widthEnd === null) return { ok: false, reason: "Unterminated {width} argument." };
    widthArg = contentAfterBeginName.slice(cursor + 1, widthEnd);
    cursor = widthEnd + 1;
  }

  while (/\s/.test(contentAfterBeginName[cursor])) cursor++;
  if (contentAfterBeginName[cursor] !== "{") {
    return { ok: false, reason: "Couldn't find the column spec argument." };
  }
  const specEnd = findMatchingBrace(contentAfterBeginName, cursor);
  if (specEnd === null) return { ok: false, reason: "Unterminated column spec argument." };
  const colSpecRaw = contentAfterBeginName.slice(cursor + 1, specEnd);
  const colSpec = parseColSpec(colSpecRaw);
  if (!colSpec) return { ok: false, reason: `Column spec "${colSpecRaw}" uses something other than plain l/c/r columns.` };

  const body = contentAfterBeginName.slice(specEnd + 1);
  if (UNSUPPORTED_BODY_RE.test(body)) {
    return { ok: false, reason: "Uses \\cline, booktabs rules, or a nested environment." };
  }

  const tokens = tokenizeBody(body);
  const split = splitIntoRawRows(tokens);
  if (!split.ok) return { ok: false, reason: split.reason };
  const interpreted = interpretGrid(split.rawRows, colSpec.columns.length);
  if (!interpreted.ok) return { ok: false, reason: interpreted.reason };

  return {
    ok: true,
    model: {
      widthArg,
      columns: colSpec.columns,
      verticalBorders: colSpec.verticalBorders,
      rows: interpreted.rows,
      horizontalBorders: split.horizontalBorders,
    },
  };
}

export function findTabularEnvironments(text: string): TabularMatch[] {
  const matches: TabularMatch[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const beginMatch = TABULAR_ENV_RE.exec(text.slice(searchFrom));
    if (!beginMatch) break;
    const beginStart = searchFrom + beginMatch.index;
    const envName = beginMatch[1];
    const afterBeginTag = beginStart + beginMatch[0].length;
    const beginLine = text.slice(0, beginStart).split("\n").length;

    const escapedName = envName.replace("*", "\\*");
    const endRe = new RegExp(`\\\\end\\{${escapedName}\\}`);
    const endMatch = endRe.exec(text.slice(afterBeginTag));
    if (!endMatch) {
      // Unterminated — nothing sensible to show; stop scanning from here.
      searchFrom = afterBeginTag;
      continue;
    }
    const to = afterBeginTag + endMatch.index + endMatch[0].length;
    const contentAfterBeginName = text.slice(afterBeginTag, afterBeginTag + endMatch.index);

    const parsed = parseTabular(envName, contentAfterBeginName);
    matches.push({
      envName,
      from: beginStart,
      to,
      beginLine,
      raw: text.slice(beginStart, to),
      supported: parsed.ok,
      reason: parsed.ok ? undefined : parsed.reason,
      model: parsed.ok ? parsed.model : undefined,
    });

    searchFrom = to;
  }

  return matches;
}

function serializeColSpec(columns: TableColumn[], verticalBorders: boolean[]): string {
  let out = "";
  for (let i = 0; i < columns.length; i++) {
    if (verticalBorders[i]) out += "|";
    out += columns[i].align;
  }
  if (verticalBorders[columns.length]) out += "|";
  return out;
}

function serializeCell(cell: TableCell): string | null {
  switch (cell.kind) {
    case "text":
      return cell.text;
    case "multicolumn": {
      const spec = (cell.leftBorder ? "|" : "") + cell.align + (cell.rightBorder ? "|" : "");
      return `\\multicolumn{${cell.colspan}}{${spec}}{${cell.text}}`;
    }
    case "multirow":
      return `\\multirow{${cell.rowspan}}{${cell.width}}{${cell.text}}`;
    case "covered":
      // A colspan-covered slot has no `&`-token of its own in the source at
      // all (the multicolumn's colspan already accounts for it); a
      // rowspan-covered slot still needs a real, empty `&`-slot.
      return cell.by === "colspan" ? null : "";
  }
}

export function serializeTabular(envName: string, model: TableGridModel): string {
  const colSpec = serializeColSpec(model.columns, model.verticalBorders);
  const widthPart = model.widthArg !== null ? `{${model.widthArg}}` : "";
  let body = "";
  for (let r = 0; r < model.rows.length; r++) {
    if (model.horizontalBorders[r]) body += "\\hline\n";
    const cellStrs = model.rows[r].map(serializeCell).filter((s): s is string => s !== null);
    body += `${cellStrs.join(" & ")} \\\\\n`;
  }
  if (model.horizontalBorders[model.rows.length]) body += "\\hline\n";
  return `\\begin{${envName}}${widthPart}{${colSpec}}\n${body}\\end{${envName}}`;
}

export function emptyGridModel(rows: number, columns: number): TableGridModel {
  return {
    widthArg: null,
    columns: Array.from({ length: columns }, () => ({ align: "l" as ColumnAlign })),
    verticalBorders: Array.from({ length: columns + 1 }, () => false),
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => ({ kind: "text" as const, text: "" }))),
    horizontalBorders: Array.from({ length: rows + 1 }, () => false),
  };
}

export function cloneGridModel(model: TableGridModel): TableGridModel {
  return {
    widthArg: model.widthArg,
    columns: model.columns.map((c) => ({ ...c })),
    verticalBorders: [...model.verticalBorders],
    rows: model.rows.map((row) => row.map((cell) => ({ ...cell }))),
    horizontalBorders: [...model.horizontalBorders],
  };
}

/** Whether column `c` can be removed without disturbing a span — true only
 * when every cell in that column, across all rows, is a plain "text" cell
 * (a covered/multicolumn/multirow cell means some row's span touches it).
 * Callers should hide/disable the remove-column control otherwise rather
 * than guess how to shrink or re-route the span. */
export function canRemoveColumn(model: TableGridModel, c: number): boolean {
  if (model.columns.length <= 1) return false;
  return model.rows.every((row) => row[c].kind === "text");
}

/** Same as `canRemoveColumn`, for rows. */
export function canRemoveRow(model: TableGridModel, r: number): boolean {
  if (model.rows.length <= 1) return false;
  return model.rows[r].every((cell) => cell.kind === "text");
}

/** Merges cell (r, c) with its immediate right neighbor into (or extends an
 * existing) `\multicolumn`. Only merges plain "text" cells into an existing
 * or new multicolumn span — never touches a `\multirow` (combined
 * colspan+rowspan on one cell is out of scope) or a cell already covered by
 * some other span. Returns `null` if the merge isn't applicable. */
export function mergeRight(model: TableGridModel, r: number, c: number): TableGridModel | null {
  const cell = model.rows[r][c];
  if (cell.kind === "covered" || cell.kind === "multirow") return null;
  const span = cell.kind === "multicolumn" ? cell.colspan : 1;
  const rightCol = c + span;
  if (rightCol >= model.columns.length) return null;
  const rightCell = model.rows[r][rightCol];
  if (rightCell.kind !== "text") return null;

  const leftText = cell.text;
  const mergedText = [leftText, rightCell.text].filter(Boolean).join(" ");
  const align = cell.kind === "multicolumn" ? cell.align : model.columns[c].align;
  const leftBorder = cell.kind === "multicolumn" ? cell.leftBorder : model.verticalBorders[c];
  const rightBorder = model.verticalBorders[rightCol + 1];

  const next = cloneGridModel(model);
  next.rows[r][c] = { kind: "multicolumn", text: mergedText, colspan: span + 1, align, leftBorder, rightBorder };
  next.rows[r][rightCol] = { kind: "covered", by: "colspan" };
  return next;
}

/** Merges cell (r, c) with its immediate lower neighbor into (or extends an
 * existing) `\multirow`. Same restrictions as `mergeRight`, mirrored:
 * never touches a `\multicolumn` or an already-covered cell. */
export function mergeDown(model: TableGridModel, r: number, c: number): TableGridModel | null {
  const cell = model.rows[r][c];
  if (cell.kind === "covered" || cell.kind === "multicolumn") return null;
  const span = cell.kind === "multirow" ? cell.rowspan : 1;
  const belowRow = r + span;
  if (belowRow >= model.rows.length) return null;
  const belowCell = model.rows[belowRow][c];
  if (belowCell.kind !== "text") return null;

  const mergedText = [cell.text, belowCell.text].filter(Boolean).join(" ");
  const width = cell.kind === "multirow" ? cell.width : "*";

  const next = cloneGridModel(model);
  next.rows[r][c] = { kind: "multirow", text: mergedText, rowspan: span + 1, width };
  next.rows[belowRow][c] = { kind: "covered", by: "rowspan" };
  return next;
}

/** Reverts a `multicolumn`/`multirow` cell back to plain text cells — the
 * origin cell keeps the text, the cells it used to cover become empty. A
 * no-op (returns an equivalent clone) for a plain or covered cell. */
export function splitCell(model: TableGridModel, r: number, c: number): TableGridModel {
  const cell = model.rows[r][c];
  const next = cloneGridModel(model);
  if (cell.kind === "multicolumn") {
    next.rows[r][c] = { kind: "text", text: cell.text };
    for (let k = 1; k < cell.colspan; k++) next.rows[r][c + k] = { kind: "text", text: "" };
  } else if (cell.kind === "multirow") {
    next.rows[r][c] = { kind: "text", text: cell.text };
    for (let k = 1; k < cell.rowspan; k++) next.rows[r + k][c] = { kind: "text", text: "" };
  }
  return next;
}
