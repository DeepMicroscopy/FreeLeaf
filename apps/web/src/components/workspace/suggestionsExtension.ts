import { Decoration, EditorView, closeHoverTooltips, hoverTooltip } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type * as Y from "yjs";

import { acceptSuggestionAt, colorForUserId, rejectSuggestionAt } from "./suggestions";
import type { SuggestionSpan } from "./suggestions";

export const setSuggestionDecorations = StateEffect.define<DecorationSet>();

export const suggestionDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestionDecorations)) return effect.value;
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** One `Decoration.mark` per span, colored per-author (same color the
 * collaborator's presence cursor uses) — insertions get an underline,
 * deletions a strikethrough, both over a light author-colored background. */
export function computeSuggestionDecorations(spans: SuggestionSpan[]): DecorationSet {
  if (spans.length === 0) return Decoration.none;
  const decorations = spans.map((span) => {
    const { color, colorLight } = colorForUserId(span.authorId);
    const style =
      span.kind === "ins"
        ? `background-color:${colorLight};text-decoration:underline;text-decoration-color:${color};text-decoration-thickness:2px;`
        : `background-color:${colorLight};text-decoration:line-through;text-decoration-color:${color};opacity:0.75;`;
    return Decoration.mark({ attributes: { style } }).range(span.from, span.to);
  });
  return Decoration.set(decorations, true);
}

function formatRelativeTime(ts: number): string {
  if (!ts) return "";
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** Hover popover: author + relative time always; Accept/Reject buttons only
 * for callers who pass `canModerate: true` (owner/editor — a reviewer can
 * make suggestions but not resolve their own or anyone else's, matching a
 * normal "author decides" review workflow). Re-reads the span list fresh on
 * every hover via `getSpans()` rather than closing over a snapshot, so it's
 * never showing stale accept/reject targets. */
export function suggestionHoverTooltip(
  getSpans: () => SuggestionSpan[],
  getYtext: () => Y.Text,
  canModerate: () => boolean,
) {
  return hoverTooltip(
    (_view, pos) => {
      const span = getSpans().find((s) => pos >= s.from && pos < s.to);
      if (!span) return null;
      return {
        pos: span.from,
        end: span.to,
        above: true,
        create() {
          const dom = document.createElement("div");
          dom.className = "cm-suggestionTooltip";

          const info = document.createElement("div");
          info.className = "cm-suggestionTooltipInfo";
          const kindLabel = span.kind === "ins" ? "Suggested insertion" : "Suggested deletion";
          info.textContent = `${kindLabel} · ${span.authorName} · ${formatRelativeTime(span.ts)}`;
          dom.appendChild(info);

          if (canModerate()) {
            const actions = document.createElement("div");
            actions.className = "cm-suggestionTooltipActions";

            const acceptBtn = document.createElement("button");
            acceptBtn.textContent = "Accept";
            acceptBtn.className = "cm-suggestionTooltipAccept";
            acceptBtn.onclick = (e) => {
              e.preventDefault();
              acceptSuggestionAt(getYtext(), span.from, span.to, span.kind);
              _view.dispatch({ effects: closeHoverTooltips });
            };

            const rejectBtn = document.createElement("button");
            rejectBtn.textContent = "Reject";
            rejectBtn.className = "cm-suggestionTooltipReject";
            rejectBtn.onclick = (e) => {
              e.preventDefault();
              rejectSuggestionAt(getYtext(), span.from, span.to, span.kind);
              _view.dispatch({ effects: closeHoverTooltips });
            };

            actions.appendChild(acceptBtn);
            actions.appendChild(rejectBtn);
            dom.appendChild(actions);
          }

          return { dom };
        },
      };
    },
    { hideOnChange: true },
  );
}
