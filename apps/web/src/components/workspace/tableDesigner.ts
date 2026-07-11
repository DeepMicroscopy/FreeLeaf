/** Table Designer (Plan.md §9 Phase 10): parses/serializes `tabular`-family
 * LaTeX environments into a plain grid model an interactive UI can edit.
 * Deliberately scoped to the common case, same "best-effort, not a real
 * parser" discipline as log_parser.py/polishingLint.ts — anything using
 * `\multicolumn`, `\multirow`, `\cline`, booktabs rules (`\toprule` etc.),
 * a nested environment, a non-l/c/r column type (`p{}`, `m{}`, `@{}`, ...),
 * a mismatched cell count, or a doubled `\hline`/`|` is reported as
 * *unsupported* rather than silently mangled — the caller should refuse to
 * open the designer and say why, not guess.
 */

export type ColumnAlign = "l" | "c" | "r";

export interface TableColumn {
  align: ColumnAlign;
}

export interface TableGridModel {
  /** The `{width}` argument `tabular*`/`tabularx` take before the column
   * spec; null for plain `tabular`/`longtable`. Preserved verbatim, unparsed. */
  widthArg: string | null;
  columns: TableColumn[];
  /** Length columns.length + 1 — one slot before each column and one after the last. */
  verticalBorders: boolean[];
  rows: string[][];
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
const UNSUPPORTED_BODY_RE = /\\(multicolumn|multirow|cline|toprule|midrule|bottomrule|begin)\b/;

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

function buildRows(
  tokens: Token[],
  columnCount: number,
): { ok: true; rows: string[][]; horizontalBorders: boolean[] } | { ok: false; reason: string } {
  const rows: string[][] = [];
  const horizontalBorders: boolean[] = [];
  let currentCells: string[] = [];
  let cellBuf = "";
  let sawTextInRow = false;
  let pendingHline = false;

  const finalizeCell = () => {
    currentCells.push(cellBuf.trim());
    cellBuf = "";
  };
  const finalizeRow = (): string | null => {
    finalizeCell();
    if (currentCells.length !== columnCount) {
      return `A row has ${currentCells.length} cell(s) but the column spec defines ${columnCount}.`;
    }
    horizontalBorders.push(pendingHline);
    rows.push(currentCells);
    currentCells = [];
    pendingHline = false;
    sawTextInRow = false;
    return null;
  };

  for (const tok of tokens) {
    if (tok.kind === "hline") {
      if (sawTextInRow) return { ok: false, reason: "Found \\hline in the middle of a row." };
      if (pendingHline) return { ok: false, reason: "Doubled \\hline (double rule) isn't supported yet." };
      pendingHline = true;
    } else if (tok.kind === "cellsep") {
      finalizeCell();
    } else if (tok.kind === "rowsep") {
      const err = finalizeRow();
      if (err) return { ok: false, reason: err };
    } else {
      cellBuf += tok.value;
      if (tok.value.trim()) sawTextInRow = true;
    }
  }
  if (cellBuf.trim() || currentCells.length > 0) {
    const err = finalizeRow();
    if (err) return { ok: false, reason: err };
  }
  horizontalBorders.push(pendingHline);

  return { ok: true, rows, horizontalBorders };
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
    return { ok: false, reason: "Uses \\multicolumn, \\multirow, \\cline, booktabs rules, or a nested environment." };
  }

  const tokens = tokenizeBody(body);
  const built = buildRows(tokens, colSpec.columns.length);
  if (!built.ok) return { ok: false, reason: built.reason };

  return {
    ok: true,
    model: {
      widthArg,
      columns: colSpec.columns,
      verticalBorders: colSpec.verticalBorders,
      rows: built.rows,
      horizontalBorders: built.horizontalBorders,
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

export function serializeTabular(envName: string, model: TableGridModel): string {
  const colSpec = serializeColSpec(model.columns, model.verticalBorders);
  const widthPart = model.widthArg !== null ? `{${model.widthArg}}` : "";
  let body = "";
  for (let r = 0; r < model.rows.length; r++) {
    if (model.horizontalBorders[r]) body += "\\hline\n";
    body += `${model.rows[r].join(" & ")} \\\\\n`;
  }
  if (model.horizontalBorders[model.rows.length]) body += "\\hline\n";
  return `\\begin{${envName}}${widthPart}{${colSpec}}\n${body}\\end{${envName}}`;
}

export function emptyGridModel(rows: number, columns: number): TableGridModel {
  return {
    widthArg: null,
    columns: Array.from({ length: columns }, () => ({ align: "l" as ColumnAlign })),
    verticalBorders: Array.from({ length: columns + 1 }, () => false),
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, () => "")),
    horizontalBorders: Array.from({ length: rows + 1 }, () => false),
  };
}
