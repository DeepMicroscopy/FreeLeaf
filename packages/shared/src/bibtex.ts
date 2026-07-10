/** Minimal BibTeX parser/serializer (PLAN.md §9 Phase 6). Hand-rolled rather
 * than a dependency: BibTeX's `@type{key, field = {value}, ...}` shape is a
 * long-stable, well-documented text format (not a live API), and rolling our
 * own gives exact control over round-trip serialization, which matters for
 * making clean, minimal edits to a shared Yjs document (see lib/bibliography.tsx).
 * Best-effort, not a full BibTeX grammar: handles brace- and quote-delimited
 * values (with balanced-brace nesting inside `{...}` values), bare numeric
 * values, and skips anything before the first recognizable `@type{` — good
 * enough for the common case, not a guarantee against pathological input.
 */

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
  /** Char offsets of the entry within the source it was parsed from — used
   * to make precise, minimal edits to a shared Y.Text instead of rewriting
   * the whole document. */
  start: number;
  end: number;
}

export function parseBibtex(source: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const len = source.length;
  let i = 0;

  while (i < len) {
    const at = source.indexOf("@", i);
    if (at === -1) break;

    let j = at + 1;
    while (j < len && /[a-zA-Z]/.test(source[j])) j++;
    const type = source.slice(at + 1, j).toLowerCase();

    while (j < len && /\s/.test(source[j])) j++;
    if (source[j] !== "{" && source[j] !== "(") {
      i = at + 1;
      continue;
    }
    const closeChar = source[j] === "{" ? "}" : ")";
    j++;

    const keyStart = j;
    while (j < len && source[j] !== "," && source[j] !== closeChar) j++;
    const key = source.slice(keyStart, j).trim();

    const fields: Record<string, string> = {};
    while (j < len && source[j] !== closeChar) {
      if (source[j] === "," || /\s/.test(source[j])) {
        j++;
        continue;
      }
      const nameStart = j;
      while (j < len && /[a-zA-Z0-9_-]/.test(source[j])) j++;
      const name = source.slice(nameStart, j).toLowerCase();
      if (!name) {
        j++;
        continue;
      }
      while (j < len && /\s/.test(source[j])) j++;
      if (source[j] !== "=") break; // malformed field — stop parsing this entry's fields

      j++;
      while (j < len && /\s/.test(source[j])) j++;

      let value = "";
      if (source[j] === "{") {
        let depth = 1;
        j++;
        const valStart = j;
        while (j < len && depth > 0) {
          if (source[j] === "{") depth++;
          else if (source[j] === "}") depth--;
          if (depth > 0) j++;
        }
        value = source.slice(valStart, j);
        j++;
      } else if (source[j] === '"') {
        j++;
        const valStart = j;
        while (j < len && source[j] !== '"') j++;
        value = source.slice(valStart, j);
        j++;
      } else {
        const valStart = j;
        while (j < len && source[j] !== "," && source[j] !== closeChar) j++;
        value = source.slice(valStart, j).trim();
      }
      fields[name] = value;

      while (j < len && /\s/.test(source[j])) j++;
      if (source[j] === ",") j++;
    }
    j = source.indexOf(closeChar, j);
    j = j === -1 ? len : j + 1;

    if (key) entries.push({ type, key, fields, start: at, end: j });
    i = j;
  }

  return entries;
}

export function serializeEntry(entry: { type: string; key: string; fields: Record<string, string> }): string {
  const fieldLines = Object.entries(entry.fields)
    .map(([name, value]) => `  ${name} = {${value}}`)
    .join(",\n");
  return `@${entry.type}{${entry.key},\n${fieldLines}\n}\n`;
}

/** Cheap detection for paste/drop interception — not a validity check, just
 * "does this look enough like BibTeX to try parsing it instead of pasting
 * it as plain text." */
export function looksLikeBibtex(text: string): boolean {
  return /@\s*[a-zA-Z]+\s*[{(]\s*[^\s,{}()]+\s*,/.test(text);
}
