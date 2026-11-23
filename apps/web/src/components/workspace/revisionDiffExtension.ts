import { diffLines, diffWordsWithSpace } from "diff";
import type { Change } from "diff";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";

// Revision-diff linking: two files can be linked as revisions of each
// other (files_api.py's ProjectFile.diff_baseline) so the editor shows a
// permanent diff of the live document against the linked "previous copy"
// file's content — e.g. seeing what's changed since a paper's submitted
// version while revising against reviewer feedback. Adapted from
// trackChangesExtension.ts (removed in 5a4ddcd, recovered via `git show
// 5a4ddcd^:...`) — that mechanism was replaced for Reviewing mode's
// suggestion tracking specifically because that use case needed
// per-author, per-character, concurrent-reviewer-aware tracking, which a
// static diff can't express (docs/decisions/suggested-edits.md). Neither
// concern applies here: comparing against a frozen, independent sibling
// document is exactly what a static diff is good at, so the two systems
// coexist independently (and may legitimately overlap visually — a
// suggested edit inside a revision-diff region is fine, ordinary
// CodeMirror decoration layering).
export const setRevisionDiffDecorations = StateEffect.define<DecorationSet>();

export const revisionDiffField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRevisionDiffDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

class RemovedRevisionTextWidget extends WidgetType {
  readonly text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  eq(other: RemovedRevisionTextWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-revisionDelete";
    span.textContent = this.text;
    return span;
  }
}

// A word-level diff of two substantially-rewritten sentences tends to find
// short runs of genuinely identical text (a lone "and"/"to"/"of the")
// stranded between real changes, purely because they happen to match —
// mathematically correct (it's the true shortest edit script) but visually
// chaotic: a dozen tiny alternating red/green fragments instead of two or
// three readable "this phrase became that phrase" blocks. jsdiff has no
// built-in cleanup for this (unlike e.g. diff-match-patch's
// diff_cleanupSemantic); this is a hand-rolled version scoped to this one
// readability problem: an unchanged run of at most MAX_ABSORBED_WORDS
// words, sitting between a change on *both* sides, gets folded into that
// surrounding change instead of staying its own stable island. Absorbing
// means splitting it into a removed copy (joins the old-side text) and an
// added copy (joins the new-side text) — the word visibly appears on both
// sides of the replacement, which reads correctly for "this whole phrase
// was replaced" rather than implying the connector word itself changed.
const MAX_ABSORBED_WORDS = 2;

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function fuseSmallGaps(parts: Change[]): Change[] {
  // A genuine word substitution already comes out of diffWordsWithSpace as
  // removed-then-added *immediately adjacent* — so simply merging adjacent
  // same-type parts never fires once a small common run is absorbed into
  // both sides (removed, added, removed, added, ... never has two
  // same-type neighbors). Instead, walk the whole run of changes (real
  // added/removed parts plus any small common parts absorbed into it) as
  // one cluster, build its combined old-side and new-side text in a single
  // pass, and emit exactly one removed block followed by one added block
  // for that whole cluster — removed first so its (zero-width) widget
  // lands immediately before the live inserted text it's being read
  // alongside.
  const result: Change[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      // A real anchor: either too long to absorb, or not followed by
      // more change at all (so there's no cluster to absorb it into).
      result.push(part);
      i++;
      continue;
    }

    let removedText = "";
    let addedText = "";
    while (i < parts.length) {
      const p = parts[i];
      const isCommon = !p.added && !p.removed;
      if (isCommon) {
        const next = parts[i + 1];
        const nextIsChange = !!next && (!!next.added || !!next.removed);
        if (!nextIsChange || wordCount(p.value) > MAX_ABSORBED_WORDS) break;
        removedText += p.value;
        addedText += p.value;
      } else if (p.removed) {
        removedText += p.value;
      } else {
        addedText += p.value;
      }
      i++;
    }
    if (removedText) result.push({ value: removedText, added: false, removed: true, count: 0 });
    if (addedText) result.push({ value: addedText, added: true, removed: false, count: 0 });
  }
  return result;
}

// `diffWordsWithSpace` over the whole document is O(size × edit distance) —
// on a ~100KB/14k-word paper this measured ~1.75s *per keystroke* (debounced,
// but still a long main-thread stall), regardless of where the edit was.
// `diffLines` first is far cheaper (most lines match exactly, so the LCS
// problem it solves is tiny), and the vast majority of the document ends up
// in long unchanged-line runs that never need a word-level look at all —
// word-diffing only the small number of actually-changed line-hunks measured
// ~40x faster on the same document (~1.75s → ~44ms), independent of where in
// the document the edit lands. A hunk that's pure insertion or pure deletion
// (no corresponding text on the other side) skips the word-diff entirely.
function hierarchicalWordDiff(oldText: string, newText: string): Change[] {
  const lineParts = diffLines(oldText, newText);
  const out: Change[] = [];
  let i = 0;
  while (i < lineParts.length) {
    const part = lineParts[i];
    if (!part.added && !part.removed) {
      out.push(part);
      i++;
      continue;
    }
    // A run of consecutive changed line-hunks between two matching anchors —
    // word-diff just this run's old/new text, not the whole document.
    let oldSide = "";
    let newSide = "";
    while (i < lineParts.length && (lineParts[i].added || lineParts[i].removed)) {
      if (lineParts[i].removed) oldSide += lineParts[i].value;
      else newSide += lineParts[i].value;
      i++;
    }
    if (oldSide && newSide) {
      out.push(...diffWordsWithSpace(oldSide, newSide));
    } else if (oldSide) {
      out.push({ value: oldSide, added: false, removed: true, count: 0 });
    } else {
      out.push({ value: newSide, added: true, removed: false, count: 0 });
    }
  }
  return out;
}

/** Computes decorations by walking `fuseSmallGaps(hierarchicalWordDiff(...))`
 * hunk by hunk, tracking a running position in `currentText` — unchanged
 * and added hunks advance that position (their text is really there in the
 * live doc); removed hunks don't (their text only exists in the
 * baseline), so they're rendered as a zero-width widget at the position
 * they would have occupied.
 *
 * Word-level, not line-level: an early version used `diffLines`, which
 * marked an *entire line* as removed+added whenever even one word changed
 * within it — confusing (looked like a full rewrite for a single-digit
 * edit, e.g. "365 cases" → "122 cases" struck through both whole
 * sentences). `diffWordsWithSpace` (preserves whitespace/newlines as real
 * content, unlike plain `diffWords`) narrows the decoration down to just
 * the words that actually changed — but taken alone, for a heavily
 * rewritten sentence, that reintroduces the opposite problem (many tiny
 * fragmented changes instead of a couple of readable ones), which
 * `fuseSmallGaps` cleans up before this function ever sees the parts. */
export function computeRevisionDiffDecorations(baselineText: string, currentText: string): DecorationSet {
  if (baselineText === currentText) return Decoration.none;
  const parts = fuseSmallGaps(hierarchicalWordDiff(baselineText, currentText));
  const decorations = [];
  let pos = 0;

  for (const part of parts) {
    if (part.added) {
      const length = part.value.length;
      if (length > 0) decorations.push(Decoration.mark({ class: "cm-revisionInsert" }).range(pos, pos + length));
      pos += length;
    } else if (part.removed) {
      if (part.value.length > 0) {
        decorations.push(
          Decoration.widget({ widget: new RemovedRevisionTextWidget(part.value), side: -1 }).range(pos),
        );
      }
    } else {
      pos += part.value.length;
    }
  }

  return Decoration.set(decorations, true);
}
