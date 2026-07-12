import * as Y from "yjs";

// Live, per-user "suggested edits" for Reviewing mode (Plan.md §9 Phase 8
// extension) — replaces the old approach of diffing the live file against a
// snapshot baseline (trackChangesExtension.ts, now removed) with real CRDT
// attribution: every insertion/deletion made while suggesting is tagged
// directly on the shared Y.Text as a Yjs rich-text formatting attribute, so
// decorations don't need a diff at all — they're read straight off the live
// document, work correctly with several concurrent reviewers at once, and
// survive reload/reconnect for free (it's just part of the CRDT).
//
// A "suggested deletion" is never a real Y.Text delete — the text stays in
// the document, tagged `sugg: "del"`, until someone accepts (really deletes
// it) or rejects (strips the tag, keeping it) the suggestion. This is the
// only way deleted text can still be shown (struck through) and reversible.

/** Deterministic per-user color (same user -> same color, every session, no
 * server-side registry needed) — shared between collaborator presence
 * cursors (CodeMirrorEditor.tsx) and suggestion highlighting, so the two
 * visually match up. */
export function colorForUserId(id: string): { color: string; colorLight: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return { color: `hsl(${hue} 70% 45%)`, colorLight: `hsl(${hue} 70% 45% / 0.25)` };
}

export type SuggestionKind = "ins" | "del";

export interface SuggestionAttrs {
  sugg: SuggestionKind;
  authorId: string;
  authorName: string;
  ts: number;
}

export interface SuggestionSpan {
  from: number;
  to: number;
  kind: SuggestionKind;
  authorId: string;
  authorName: string;
  ts: number;
}

/** Yjs stores `null` to mean "unset this attribute" (Quill-delta convention)
 * — this is what a clean, non-suggested run's attributes look like after
 * `format(..., clearSuggestionAttrs)`. */
export const CLEAR_SUGGESTION_ATTRS: Record<string, null> = {
  sugg: null,
  authorId: null,
  authorName: null,
  ts: null,
};

/** Walks the Y.Text's rich-text delta and reconstructs contiguous suggestion
 * spans with document offsets — the single source of truth for both the
 * decorations and the hover/accept/reject UI, so they can never disagree
 * about where a span starts/ends. */
export function computeSuggestionSpans(ytext: Y.Text): SuggestionSpan[] {
  const spans: SuggestionSpan[] = [];
  let pos = 0;
  for (const op of ytext.toDelta() as { insert: string; attributes?: Record<string, unknown> }[]) {
    const len = op.insert.length;
    const attrs = op.attributes;
    if (attrs && (attrs.sugg === "ins" || attrs.sugg === "del")) {
      const prev = spans[spans.length - 1];
      if (
        prev &&
        prev.to === pos &&
        prev.kind === attrs.sugg &&
        prev.authorId === attrs.authorId &&
        prev.ts === attrs.ts
      ) {
        prev.to = pos + len;
      } else {
        spans.push({
          from: pos,
          to: pos + len,
          kind: attrs.sugg,
          authorId: String(attrs.authorId ?? ""),
          authorName: String(attrs.authorName ?? "Someone"),
          ts: Number(attrs.ts ?? 0),
        });
      }
    }
    pos += len;
  }
  return spans;
}

function findSpanAt(ytext: Y.Text, from: number, to: number): SuggestionSpan | null {
  return computeSuggestionSpans(ytext).find((s) => s.from === from && s.to === to) ?? null;
}

const COALESCE_WINDOW_MS = 3000;

/** Marks a just-made local edit's range as a suggestion — call this right
 * after the range already reflects the edit (for an insertion, the plain
 * text has already landed at [from, to); for a suppressed deletion, the
 * kept-in-place text already sits there unformatted).
 *
 * Continuous editing should read as one suggestion, not one per keystroke,
 * in both directions:
 *
 * - For insertions, Yjs's Y.Text auto-inherits the *preceding* run's
 *   formatting for a plain insert with no attributes of its own (a
 *   Quill-delta-compatible behavior) — if that inheritance already landed
 *   the same author's recent "ins" tag on this exact range, it's left alone
 *   so its *original* timestamp survives and `computeSuggestionSpans`
 *   merges it with what came before.
 * - Deletions never benefit from that inheritance (nothing is being
 *   inserted, just an already-present range getting formatted), and
 *   backward deletion extends *before* the existing span rather than
 *   directly after it — so both cases fall through to explicitly merging
 *   with any adjacent (not just covering) same-author/kind/recent span,
 *   re-tagging the union under the *earlier* span's original timestamp. */
export function ensureSuggestionTag(
  ytext: Y.Text,
  from: number,
  to: number,
  kind: SuggestionKind,
  authorId: string,
  authorName: string,
  now: number,
): void {
  if (to <= from) return;
  const spans = computeSuggestionSpans(ytext);
  const matches = (s: SuggestionSpan) => s.kind === kind && s.authorId === authorId && now - s.ts < COALESCE_WINDOW_MS;

  const covering = spans.find((s) => s.from <= from && s.to >= to && matches(s));
  if (covering) return;

  const adjacent = spans.find((s) => (s.to === from || s.from === to) && matches(s));
  if (adjacent) {
    const unionFrom = Math.min(adjacent.from, from);
    const unionTo = Math.max(adjacent.to, to);
    ytext.format(unionFrom, unionTo - unionFrom, { sugg: kind, authorId, authorName, ts: adjacent.ts });
    return;
  }

  ytext.format(from, to - from, { sugg: kind, authorId, authorName, ts: now });
}

/** Accept: an insertion becomes permanent plain text (strip the tag); a
 * deletion actually happens now (it was only ever staged). */
export function acceptSuggestion(ytext: Y.Text, span: Pick<SuggestionSpan, "from" | "to" | "kind">): void {
  if (span.kind === "ins") {
    ytext.format(span.from, span.to - span.from, CLEAR_SUGGESTION_ATTRS);
  } else {
    ytext.delete(span.from, span.to - span.from);
  }
}

/** Reject: an insertion never happened (delete it); a staged deletion is
 * reversed (strip the tag, keeping the text as ordinary plain text). */
export function rejectSuggestion(ytext: Y.Text, span: Pick<SuggestionSpan, "from" | "to" | "kind">): void {
  if (span.kind === "ins") {
    ytext.delete(span.from, span.to - span.from);
  } else {
    ytext.format(span.from, span.to - span.from, CLEAR_SUGGESTION_ATTRS);
  }
}

/** Re-reads the span at `(from, to)` right before acting on it, in case the
 * document shifted between when the hover tooltip was rendered and when the
 * button was clicked — refuses (no-ops) rather than risk acting on stale
 * coordinates that now point at unrelated text. */
export function acceptSuggestionAt(ytext: Y.Text, from: number, to: number, kind: SuggestionKind): void {
  const span = findSpanAt(ytext, from, to);
  if (span && span.kind === kind) acceptSuggestion(ytext, span);
}

export function rejectSuggestionAt(ytext: Y.Text, from: number, to: number, kind: SuggestionKind): void {
  const span = findSpanAt(ytext, from, to);
  if (span && span.kind === kind) rejectSuggestion(ytext, span);
}

/** Bulk actions (the "Accept all" / "Reject all" toolbar buttons) — applied
 * back-to-front so each span's `from`/`to` (captured up front) stays valid
 * as earlier operations shift positions before it. Wrapped in one Yjs
 * transaction so collaborators see a single atomic update, not a flicker of
 * partial states. */
export function acceptAllSuggestions(ytext: Y.Text, spans: SuggestionSpan[]): void {
  const ordered = [...spans].sort((a, b) => b.from - a.from);
  ytext.doc!.transact(() => {
    for (const span of ordered) acceptSuggestion(ytext, span);
  });
}

export function rejectAllSuggestions(ytext: Y.Text, spans: SuggestionSpan[]): void {
  const ordered = [...spans].sort((a, b) => b.from - a.from);
  ytext.doc!.transact(() => {
    for (const span of ordered) rejectSuggestion(ytext, span);
  });
}
