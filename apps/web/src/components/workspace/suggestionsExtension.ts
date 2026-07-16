import { Decoration, EditorView, WidgetType, closeHoverTooltips, hoverTooltip } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type * as Y from "yjs";

import { acceptSuggestionAt, colorForUserId, rejectSuggestionAt } from "./suggestions";
import type { SuggestionKind, SuggestionSpan } from "./suggestions";

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

/** A `Decoration.mark` colors the *characters* in its range — but a span
 * that covers only whitespace/newlines has no rendered glyph for a browser
 * to color at all (CodeMirror renders each line break as a line boundary,
 * not a character), so a suggestion like "deleted this newline" or
 * "inserted a space" would otherwise be fully counted yet completely
 * invisible. Render those as a small standalone marker widget instead. */
class SuggestionMarkerWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly color: string,
    private readonly colorLight: string,
    private readonly kind: SuggestionKind,
  ) {
    super();
  }
  eq(other: SuggestionMarkerWidget): boolean {
    return other.label === this.label && other.color === this.color && other.kind === this.kind;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.textContent = this.label;
    el.style.cssText = [
      "display:inline-block",
      `color:${this.color}`,
      `background-color:${this.colorLight}`,
      "border-radius:2px",
      "padding:0 2px",
      "font-size:0.85em",
      this.kind === "ins" ? `text-decoration:underline;text-decoration-color:${this.color}` : "text-decoration:line-through",
    ].join(";");
    return el;
  }
}

const WHITESPACE_ONLY = /^\s*$/;

/** One decoration per span, colored per-author (same color the
 * collaborator's presence cursor uses) — insertions get an underline,
 * deletions a strikethrough, both over a light author-colored background.
 * Whitespace/newline-only spans fall back to a small marker widget (see
 * SuggestionMarkerWidget) since a mark decoration would render nothing. */
export function computeSuggestionDecorations(spans: SuggestionSpan[], docText: string): DecorationSet {
  if (spans.length === 0) return Decoration.none;
  const decorations = spans.map((span) => {
    const { color, colorLight } = colorForUserId(span.authorId);
    const covered = docText.slice(span.from, span.to);
    if (WHITESPACE_ONLY.test(covered)) {
      const label = covered.includes("\n") ? "⏎" : "·";
      return Decoration.widget({
        widget: new SuggestionMarkerWidget(label, color, colorLight, span.kind),
        side: span.kind === "ins" ? 1 : -1,
      }).range(span.from);
    }
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

const CHECK_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const X_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

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
          const { color } = colorForUserId(span.authorId);

          const dom = document.createElement("div");
          dom.className = "cm-suggestionTooltip";

          const kind = document.createElement("div");
          kind.className = "cm-suggestionTooltipKind";
          kind.textContent = span.kind === "ins" ? "Suggested insertion" : "Suggested deletion";
          dom.appendChild(kind);

          const author = document.createElement("div");
          author.className = "cm-suggestionTooltipAuthor";
          const dot = document.createElement("span");
          dot.className = "cm-suggestionTooltipDot";
          dot.style.backgroundColor = color;
          author.appendChild(dot);
          const authorName = document.createElement("strong");
          authorName.textContent = span.authorName;
          author.appendChild(authorName);
          author.appendChild(document.createTextNode(` · ${formatRelativeTime(span.ts)}`));
          dom.appendChild(author);

          if (canModerate()) {
            const actions = document.createElement("div");
            actions.className = "cm-suggestionTooltipActions";

            const acceptBtn = document.createElement("button");
            acceptBtn.innerHTML = `${CHECK_ICON}<span>Accept</span>`;
            acceptBtn.className = "cm-suggestionTooltipAccept";
            acceptBtn.onclick = (e) => {
              e.preventDefault();
              acceptSuggestionAt(getYtext(), span.from, span.to, span.kind);
              _view.dispatch({ effects: closeHoverTooltips });
            };

            const rejectBtn = document.createElement("button");
            rejectBtn.innerHTML = `${X_ICON}<span>Reject</span>`;
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
