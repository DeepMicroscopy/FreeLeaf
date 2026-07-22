/** Which BibTeX entries are actually cited across a project's .tex files
 * (polish mode's "unused references" check). Distinct from
 * CodeMirrorEditor's citeCompletion.ts, which only matches an *open,
 * in-progress* `\cite{` at the cursor for autocomplete — this scans whole,
 * closed occurrences anywhere in a file's text. */
import type { BibEntry } from "./bibtex";

const CITE_USAGE_RE = /\\(?:cite|citep|citet|parencite|autocite|textcite)\{([^{}]*)\}/g;

/** All cite keys referenced in `texSource`, including every key in a
 * comma-separated `\cite{a,b,c}`. */
export function extractCitedKeys(texSource: string): string[] {
  const keys: string[] = [];
  for (const match of texSource.matchAll(CITE_USAGE_RE)) {
    for (const key of match[1].split(",")) {
      const trimmed = key.trim();
      if (trimmed) keys.push(trimmed);
    }
  }
  return keys;
}

/** Bib entries whose key never appears in any of `texSources`. */
export function findUnusedBibEntries(entries: BibEntry[], texSources: string[]): BibEntry[] {
  const cited = new Set<string>();
  for (const source of texSources) {
    for (const key of extractCitedKeys(source)) cited.add(key);
  }
  return entries.filter((e) => !cited.has(e.key));
}
