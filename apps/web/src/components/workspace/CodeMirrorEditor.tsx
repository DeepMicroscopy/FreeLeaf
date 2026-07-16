import { api, looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { MessageSquarePlus } from "lucide-react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import type { Transaction, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { useAuth } from "../../lib/auth";
import { useBibliography } from "../../lib/bibliography";
import { useWorkspace } from "../../lib/workspace";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { citeCompletionSource } from "./citeCompletion";
import { envCompletionSource } from "./envCompletion";
import {
  includegraphicsFileCompletionSource,
  includegraphicsOptionsCompletionSource,
} from "./includegraphicsCompletion";
import { latexSyntaxHighlighting } from "./latexHighlight";
import { packageCompletionSource } from "./packageCompletion";
import { extractLabels, findLabelOccurrences, refCompletionSource } from "./refCompletion";
import { PACKAGE_LINE_RE } from "./packageCompletion";
import type { DuplicateChoice } from "./DuplicateDialog";
import { DuplicateDialog } from "./DuplicateDialog";
import { lintLatex } from "./polishingLint";
import type { LintFinding } from "./polishingLint";
import { findTabularEnvironments, serializeTabular } from "./tableDesigner";
import type { TabularMatch } from "./tableDesigner";
import { looksLikeHtmlTable, parseHtmlTableToGridModel } from "./tablePaste";
import { tableDesignerGutter } from "./tableDesignerGutter";
import { packageDocsGutter } from "./packageDocsGutter";
import {
  computePolishingLintDecorations,
  polishingLintField,
  setPolishingLintDecorations,
} from "./polishingLintExtension";
import {
  acceptAllSuggestions,
  CLEAR_SUGGESTION_ATTRS,
  colorForUserId,
  computeSuggestionSpans,
  ensureSuggestionTag,
  rejectAllSuggestions,
} from "./suggestions";
import type { SuggestionSpan } from "./suggestions";
import { isSuggestableEdit, planSuggestionRewrite } from "./suggestionRewrite";
import {
  computeSuggestionDecorations,
  setSuggestionDecorations,
  suggestionDecorationsField,
  suggestionHoverTooltip,
} from "./suggestionsExtension";
import {
  commentAnchorsField,
  computeCommentAnchorDecorations,
  findCommentAnchorAt,
  setCommentAnchorDecorations,
} from "./commentAnchorsExtension";
import type { CommentAnchor } from "./commentAnchorsExtension";
import styles from "./CodeMirrorEditor.module.css";

type ConnectionStatus = "connecting" | "live" | "disconnected";

interface PresenceUser {
  clientId: number;
  name: string;
  color: string;
}

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13.5px",
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--accent)",
    padding: "12px 0",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-tertiary)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--accent-soft-border) !important",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-suggestionTooltip": {
    position: "relative",
    backgroundColor: "var(--bg-surface-raised)",
    border: "1px solid var(--border-default)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-lg)",
    padding: "9px 11px",
    fontFamily: "var(--font-sans)",
    fontSize: "12px",
    minWidth: "180px",
    maxWidth: "280px",
  },
  // A small downward-pointing caret so the tooltip visually connects to the
  // marked text it's describing (the tooltip itself always renders above it).
  ".cm-suggestionTooltip::after": {
    content: "''",
    position: "absolute",
    left: "16px",
    bottom: "-5px",
    width: "9px",
    height: "9px",
    backgroundColor: "var(--bg-surface-raised)",
    borderRight: "1px solid var(--border-default)",
    borderBottom: "1px solid var(--border-default)",
    transform: "rotate(45deg)",
  },
  ".cm-suggestionTooltipKind": {
    fontSize: "10.5px",
    fontWeight: 650,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-tertiary)",
  },
  ".cm-suggestionTooltipAuthor": {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    marginTop: "3px",
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
  },
  ".cm-suggestionTooltipDot": {
    display: "inline-block",
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    flexShrink: "0",
  },
  ".cm-suggestionTooltipActions": {
    display: "flex",
    gap: "6px",
    marginTop: "8px",
  },
  ".cm-suggestionTooltipAccept, .cm-suggestionTooltipReject": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11.5px",
    fontWeight: 650,
    padding: "4px 10px",
    borderRadius: "999px",
    border: "1px solid transparent",
    cursor: "pointer",
    transition: "filter 100ms var(--ease, ease)",
  },
  ".cm-suggestionTooltipAccept:hover, .cm-suggestionTooltipReject:hover": {
    filter: "brightness(1.08)",
  },
  ".cm-suggestionTooltipAccept": {
    color: "#fff",
    backgroundColor: "#16a34a",
  },
  ".cm-suggestionTooltipReject": {
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    borderColor: "color-mix(in srgb, #dc2626 55%, var(--border-default))",
  },
  ".cm-lintFinding": {
    textDecoration: "underline wavy",
    textDecorationColor: "#f59e0b",
    textUnderlineOffset: "3px",
  },
  ".cm-commentAnchor": {
    backgroundColor: "color-mix(in srgb, #eab308 25%, transparent)",
  },
  ".cm-commentAnchorResolved": {
    backgroundColor: "color-mix(in srgb, #eab308 10%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, #eab308 30%, transparent)",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, #f59e0b 55%, transparent)",
  },
  ".cm-panels": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-primary)",
  },
  ".cm-panel.cm-search": {
    padding: "6px 8px",
    borderTop: "1px solid var(--border-default)",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
  },
  ".cm-panel.cm-search label": {
    fontSize: "12px",
    color: "var(--text-secondary)",
  },
  ".cm-textfield": {
    background: "var(--bg-inset)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-default)",
    borderRadius: "4px",
    padding: "3px 6px",
    fontSize: "13px",
  },
  ".cm-button": {
    background: "var(--bg-inset)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-default)",
    borderRadius: "4px",
    padding: "3px 8px",
    fontSize: "12px",
    cursor: "pointer",
  },
  ".cm-button:hover": {
    borderColor: "var(--accent)",
  },
  // CodeMirror's own autocomplete popup ships unthemed (dark-on-light)
  // defaults — in dark mode that left every non-selected row's text the
  // same near-white as the popup's own background, effectively invisible.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--bg-surface-raised)",
    border: "1px solid var(--border-default)",
    borderRadius: "6px",
    boxShadow: "var(--shadow-lg)",
  },
  ".cm-tooltip-autocomplete ul li": {
    color: "var(--text-primary) !important",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent-soft) !important",
    color: "var(--text-primary) !important",
  },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionDetail": {
    color: "var(--text-tertiary)",
    fontStyle: "normal",
  },
  ".cm-completionMatchedText": {
    color: "var(--accent)",
    textDecoration: "none",
    fontWeight: 650,
  },
});

export interface JumpTarget {
  line: number;
  token: number;
}

export interface CodeMirrorEditorHandle {
  /** Opens CodeMirror's built-in find/replace panel (Plan.md §9 Phase 11) —
   * exposed imperatively so a toolbar button outside the editor can trigger
   * it, same pattern as `CompilePaneHandle`. */
  openSearch: () => void;
  /** Bulk-resolves every pending suggestion currently in the document (the
   * Reviewing-mode toolbar's "Accept all"/"Reject all" buttons) — see
   * suggestions.ts. */
  acceptAllSuggestions: () => void;
  rejectAllSuggestions: () => void;
  /** Fix-it assistant (fixItRules.ts) — each of these re-derives its target
   * position fresh from the *live* document at call time (same discipline
   * as the Table Designer's save: never trust a possibly-stale snapshot of
   * the text for where to edit), so a concurrent edit elsewhere can't cause
   * a wrong-position write. All three dispatch as normal tagged
   * `userEvent: "input"` edits, so they still become suggestions while
   * Reviewing, same as every other programmatic edit in this app. */
  /** Inserts `\usepackage{pkg}` after the last existing `\usepackage`/
   * `\RequirePackage` line, or after `\documentclass{...}` if there is
   * none, or at the very top as a last resort. Always succeeds. */
  applyAddPackage: (pkg: string) => boolean;
  /** Replaces the first literal occurrence of `oldFilename` with
   * `newFilename`. False if `oldFilename` no longer appears anywhere. */
  applyMissingFileFix: (oldFilename: string, newFilename: string) => boolean;
  /** Re-scans the live document for `\label{key}` occurrences (same order
   * `findLabelOccurrences` used to build the picker list) and replaces the
   * `occurrenceIndex`-th one's *entire* `\label{key}` text with
   * `replacement` (`""` to delete it outright, `\label{newKey}` to
   * rename). False if that occurrence no longer exists. */
  applyLabelFix: (key: string, occurrenceIndex: number, replacement: string) => boolean;
  /** Escapes the first unescaped `&` on the given 1-indexed line (i.e. not
   * already preceded by `\`) by inserting a `\` before it. False if the
   * line has no unescaped `&` left (already fixed, or the line shifted). */
  applyEscapeAmpersand: (lineNumber: number) => boolean;
}

interface CodeMirrorEditorProps {
  projectId: string;
  fileId: string;
  readOnly: boolean;
  onContentChanged?: () => void;
  onCompileShortcut?: () => void;
  onJumpToPdf?: (line: number) => void;
  onActivity?: () => void;
  onKeystroke?: () => void;
  onCursorLineChange?: (line: number) => void;
  jumpTarget?: JumpTarget;
  /** Reviewing mode / reviewer role (Plan.md §9 Phase 8 extension): while
   * true, local text edits are intercepted and turned into tracked
   * suggestions (author-colored, accept/reject-able) instead of direct
   * writes — see suggestionRewrite.ts/suggestions.ts. Suggestions already in
   * the document are always shown/decorated regardless of this flag; it
   * only controls whether *new* edits become suggestions. */
  suggestMode?: boolean;
  /** Whether hovering a suggestion shows Accept/Reject buttons (owner/editor
   * — decides what to do with a suggestion) or just author/time info
   * (reviewer — proposes changes but doesn't resolve them). */
  canModerateSuggestions?: boolean;
  /** Fires with the current count of pending suggestions in the document
   * whenever it changes — drives the Reviewing-mode toolbar's "N pending
   * suggestions" label and enables/disables its Accept/Reject-all buttons. */
  onSuggestionCountChange?: (count: number) => void;
  /** Polishing mode's static lint checks (Plan.md §9 Phase 8) — see
   * polishingLint.ts. */
  polishingEnabled?: boolean;
  onLintFindings?: (findings: LintFinding[]) => void;
  /** Table Designer (Plan.md §9 Phase 10) — called when the user clicks the
   * gutter icon on a `\begin{tabular}`-family line. `applyEdit` re-checks
   * the target range still matches what was parsed before writing, so a
   * concurrent edit elsewhere in the file can't cause it to clobber the
   * wrong content — it returns false (and does nothing) if the range has
   * changed since the designer was opened. */
  onOpenTableDesigner?: (match: TabularMatch, applyEdit: (newText: string) => boolean) => void;
  /** Called when the user clicks the gutter book icon on a `\usepackage`/
   * `\RequirePackage` line, with the resolved package name. */
  onOpenPackageDoc?: (packageName: string) => void;
  /** Marked-text ranges to highlight for existing comments (Plan.md §9
   * Phase 8 extension). */
  commentAnchors?: CommentAnchor[];
  /** Called when the user right-clicks a non-empty selection and picks "Add
   * comment" from the popup menu — `from`/`to` are document character
   * offsets, `line` the 1-based line the selection starts on. */
  onAddComment?: (anchor: { from: number; to: number; text: string; line: number }) => void;
  /** Called when the user plain-clicks (no modifier) inside a comment's
   * highlighted marked-text range — doesn't intercept the click, so the
   * cursor still lands there normally; just also reports which comment it
   * was so the caller can scroll it into view in the Comments pane. */
  onCommentAnchorClick?: (commentId: string) => void;
  /** Fires with the file's full current text shortly after it changes
   * (debounced) and once right after the initial Yjs sync — the sidebar's
   * Outline/Figures & Tables tabs (Plan.md §9 Phase 11) scan this rather
   * than reaching into the editor's own Yjs document. */
  onDocTextChange?: (text: string) => void;
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor(
  {
    projectId,
    fileId,
    readOnly,
    onContentChanged,
    onCompileShortcut,
    onJumpToPdf,
    jumpTarget,
    onActivity,
    onKeystroke,
    onCursorLineChange,
    suggestMode,
    canModerateSuggestions,
    onSuggestionCountChange,
    polishingEnabled,
    onLintFindings,
    onOpenTableDesigner,
    onOpenPackageDoc,
    commentAnchors,
    onAddComment,
    onCommentAnchorClick,
    onDocTextChange,
  },
  ref,
) {
  const { user } = useAuth();
  const { entries, addEntries, findNearDuplicate, findByKey } = useBibliography();
  const { files } = useWorkspace();
  const { show } = useToast();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useImperativeHandle(ref, () => ({
    openSearch: () => {
      if (viewRef.current) openSearchPanel(viewRef.current);
    },
    acceptAllSuggestions: () => {
      if (ytextRef.current) acceptAllSuggestions(ytextRef.current, suggestionSpansRef.current);
    },
    rejectAllSuggestions: () => {
      if (ytextRef.current) rejectAllSuggestions(ytextRef.current, suggestionSpansRef.current);
    },
    applyAddPackage: (pkg: string) => {
      const view = viewRef.current;
      if (!view) return false;
      const lines = view.state.doc.toString().split("\n");
      let anchorLine = -1; // 1-indexed CodeMirror line number to insert after
      for (let i = 0; i < lines.length; i++) {
        if (PACKAGE_LINE_RE.test(lines[i])) anchorLine = i + 1;
      }
      if (anchorLine === -1) {
        for (let i = 0; i < lines.length; i++) {
          if (/\\documentclass(\[[^[\]]*\])?\{[^{}]*\}/.test(lines[i])) {
            anchorLine = i + 1;
            break;
          }
        }
      }
      const insertText = `\\usepackage{${pkg}}`;
      if (anchorLine === -1) {
        view.dispatch({ changes: { from: 0, to: 0, insert: `${insertText}\n` }, userEvent: "input" });
      } else {
        const pos = view.state.doc.line(anchorLine).to;
        view.dispatch({ changes: { from: pos, to: pos, insert: `\n${insertText}` }, userEvent: "input" });
      }
      return true;
    },
    applyMissingFileFix: (oldFilename: string, newFilename: string) => {
      const view = viewRef.current;
      if (!view) return false;
      const text = view.state.doc.toString();
      const idx = text.indexOf(oldFilename);
      if (idx === -1) return false;
      view.dispatch({
        changes: { from: idx, to: idx + oldFilename.length, insert: newFilename },
        userEvent: "input",
      });
      return true;
    },
    applyLabelFix: (key: string, occurrenceIndex: number, replacement: string) => {
      const view = viewRef.current;
      if (!view) return false;
      const occurrences = findLabelOccurrences(view.state.doc.toString(), key);
      const target = occurrences[occurrenceIndex];
      if (!target) return false;
      view.dispatch({ changes: { from: target.from, to: target.to, insert: replacement }, userEvent: "input" });
      return true;
    },
    applyEscapeAmpersand: (lineNumber: number) => {
      const view = viewRef.current;
      if (!view || lineNumber < 1 || lineNumber > view.state.doc.lines) return false;
      const line = view.state.doc.line(lineNumber);
      const idx = [...line.text].findIndex((ch, i) => ch === "&" && line.text[i - 1] !== "\\");
      if (idx === -1) return false;
      const pos = line.from + idx;
      view.dispatch({ changes: { from: pos, to: pos, insert: "\\" }, userEvent: "input" });
      return true;
    },
  }));
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docTextChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContentChangedRef = useRef(onContentChanged);
  onContentChangedRef.current = onContentChanged;
  const onCompileShortcutRef = useRef(onCompileShortcut);
  onCompileShortcutRef.current = onCompileShortcut;
  const onJumpToPdfRef = useRef(onJumpToPdf);
  onJumpToPdfRef.current = onJumpToPdf;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const onKeystrokeRef = useRef(onKeystroke);
  onKeystrokeRef.current = onKeystroke;
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  onCursorLineChangeRef.current = onCursorLineChange;
  const suggestModeRef = useRef(suggestMode);
  suggestModeRef.current = suggestMode;
  const canModerateSuggestionsRef = useRef(canModerateSuggestions);
  canModerateSuggestionsRef.current = canModerateSuggestions;
  const ytextRef = useRef<Y.Text | null>(null);
  const suggestionSpansRef = useRef<SuggestionSpan[]>([]);
  const onSuggestionCountChangeRef = useRef(onSuggestionCountChange);
  onSuggestionCountChangeRef.current = onSuggestionCountChange;
  const recomputeSuggestionsRef = useRef(() => {});
  recomputeSuggestionsRef.current = () => {
    const view = viewRef.current;
    const ytext = ytextRef.current;
    if (!view || !ytext) return;
    const spans = computeSuggestionSpans(ytext);
    suggestionSpansRef.current = spans;
    view.dispatch({ effects: setSuggestionDecorations.of(computeSuggestionDecorations(spans, ytext.toString())) });
    onSuggestionCountChangeRef.current?.(spans.length);
  };
  const polishingEnabledRef = useRef(polishingEnabled);
  polishingEnabledRef.current = polishingEnabled;
  const onLintFindingsRef = useRef(onLintFindings);
  onLintFindingsRef.current = onLintFindings;
  const recomputePolishingLintRef = useRef(() => {});
  recomputePolishingLintRef.current = () => {
    const view = viewRef.current;
    if (!view) return;
    const findings = polishingEnabledRef.current ? lintLatex(view.state.doc.toString()) : [];
    view.dispatch({
      effects: setPolishingLintDecorations.of(computePolishingLintDecorations(findings, view.state.doc.length)),
    });
    onLintFindingsRef.current?.(findings);
  };
  const commentAnchorsRef = useRef(commentAnchors);
  commentAnchorsRef.current = commentAnchors;
  const recomputeCommentAnchorsRef = useRef(() => {});
  recomputeCommentAnchorsRef.current = () => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.field(commentAnchorsField);
    const decorations = computeCommentAnchorDecorations(commentAnchorsRef.current ?? [], view.state.doc.length, current);
    view.dispatch({ effects: setCommentAnchorDecorations.of(decorations) });
  };
  const onCommentAnchorClickRef = useRef(onCommentAnchorClick);
  onCommentAnchorClickRef.current = onCommentAnchorClick;
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  const onDocTextChangeRef = useRef(onDocTextChange);
  onDocTextChangeRef.current = onDocTextChange;
  const [commentMenu, setCommentMenu] = useState<{ x: number; y: number; from: number; to: number; text: string; line: number } | null>(null);
  const onOpenTableDesignerRef = useRef(onOpenTableDesigner);
  onOpenTableDesignerRef.current = onOpenTableDesigner;
  const onOpenPackageDocRef = useRef(onOpenPackageDoc);
  onOpenPackageDocRef.current = onOpenPackageDoc;
  const handlePackageDocsGutterClickRef = useRef((_packageName: string) => {});
  handlePackageDocsGutterClickRef.current = (packageName: string) => {
    onOpenPackageDocRef.current?.(packageName);
  };
  const handleTableGutterClickRef = useRef((_lineNumber: number) => {});
  handleTableGutterClickRef.current = (lineNumber: number) => {
    const view = viewRef.current;
    if (!view || !onOpenTableDesignerRef.current) return;
    const currentText = view.state.doc.toString();
    const match = findTabularEnvironments(currentText).find((m) => m.beginLine === lineNumber);
    if (!match) return;
    onOpenTableDesignerRef.current(match, (newText: string) => {
      const liveView = viewRef.current;
      if (!liveView) return false;
      // Re-verify the target range is unchanged since the designer opened —
      // if something else edited it meanwhile (this file has no lock, and
      // Yjs merges concurrent edits), refuse rather than clobber it.
      if (liveView.state.sliceDoc(match.from, match.to) !== match.raw) return false;
      // Tagged as real input, same reasoning as the BibTeX paste-insert above
      // — a Table Designer save must also become a suggestion while
      // suggesting, not a way to bypass it.
      liveView.dispatch({ changes: { from: match.from, to: match.to, insert: newText }, userEvent: "input" });
      return true;
    });
  };
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const imageFilePathsRef = useRef<string[]>([]);
  imageFilePathsRef.current = files.filter((f) => f.type === "image").map((f) => f.path);
  const addEntriesRef = useRef(addEntries);
  addEntriesRef.current = addEntries;
  const findNearDuplicateRef = useRef(findNearDuplicate);
  findNearDuplicateRef.current = findNearDuplicate;
  const findByKeyRef = useRef(findByKey);
  findByKeyRef.current = findByKey;

  const [dupModal, setDupModal] = useState<{
    existing: BibEntry;
    incoming: { key: string; fields: Record<string, string> };
    resolve: (choice: DuplicateChoice) => void;
  } | null>(null);
  const showDuplicateModalRef = useRef<
    (existing: BibEntry, incoming: { key: string; fields: Record<string, string> }) => Promise<DuplicateChoice>
  >(null!);
  if (!showDuplicateModalRef.current) {
    showDuplicateModalRef.current = (existing, incoming) =>
      new Promise<DuplicateChoice>((resolve) => {
        setDupModal({
          existing,
          incoming,
          resolve: (choice) => {
            setDupModal(null);
            resolve(choice);
          },
        });
      });
  }

  // Paste/drop of BibTeX content (Plan.md §9 Phase 6): resolve each entry —
  // exact key already present -> just cite it (no double add); same title +
  // first author under a *different* key -> ask via modal; otherwise add and
  // cite the new key. Then insert \cite{key1, key2, ...} at the position the
  // cursor was at when the paste/drop happened.
  const resolveAndCiteRef = useRef(async (_text: string, _view: EditorView, _atPos: number) => {});
  resolveAndCiteRef.current = async (text: string, view: EditorView, atPos: number) => {
    const parsed = parseBibtex(text);
    if (parsed.length === 0) {
      show("No BibTeX entries found in that content.", "error");
      return;
    }

    const resolvedKeys: string[] = [];
    for (const entry of parsed) {
      // Exact key already present -> unambiguous, just cite it. Must be
      // checked *before* the content-based near-duplicate check: an exact
      // re-paste otherwise matches itself as a "near duplicate" and pops
      // the modal needlessly.
      if (findByKeyRef.current(entry.key)) {
        resolvedKeys.push(entry.key);
        continue;
      }
      const near = findNearDuplicateRef.current(entry);
      if (near) {
        const choice = await showDuplicateModalRef.current(near, entry);
        if (choice === "skip") continue;
        if (choice === "existing") {
          resolvedKeys.push(near.key);
          continue;
        }
        // "add" falls through to adding it as a new entry below.
      }
      const { added, conflicts } = addEntriesRef.current([entry]);
      if (added.length > 0) resolvedKeys.push(added[0]);
      else if (conflicts.length > 0) resolvedKeys.push(entry.key); // race: someone else took the key between our check and now
    }

    if (resolvedKeys.length === 0) return;

    const citeText = `\\cite{${resolvedKeys.join(", ")}}`;
    view.dispatch({
      changes: { from: atPos, to: atPos, insert: citeText },
      selection: { anchor: atPos + citeText.length },
      // Tagged as real input (not a silent programmatic edit) so this
      // becomes a tracked suggestion too when suggesting — a pasted
      // citation is exactly as much "what the user just typed" as anything
      // else, and a reviewer must never be able to bypass suggestions by
      // pasting BibTeX instead of typing.
      userEvent: "input.paste",
    });
    show(`Added reference${resolvedKeys.length === 1 ? "" : "s"}: ${resolvedKeys.join(", ")}`);
  };

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [presence, setPresence] = useState<PresenceUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("connecting");
    setPresence([]);

    let provider: WebsocketProvider | null = null;
    let ydoc: Y.Doc | null = null;
    let tokenRefreshInterval: ReturnType<typeof setInterval> | null = null;
    let handleVisibility: (() => void) | null = null;
    let handleWake: (() => void) | null = null;

    (async () => {
      const [{ data }, { data: settingsData }] = await Promise.all([
        api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
          params: { path: { project_id: projectId, file_id: fileId } },
        }),
        api.GET("/api/projects/{project_id}/settings", { params: { path: { project_id: projectId } } }),
      ]);
      if (!data || cancelled) return;
      const citeAutocompleteEnabled = settingsData?.cite_autocomplete_enabled ?? true;

      ydoc = new Y.Doc();
      const ytext = ydoc.getText("content");
      ytextRef.current = ytext;
      provider = new WebsocketProvider(data.ws_url, fileId, ydoc, {
        params: { token: data.token },
      });

      // The collab token is deliberately short-lived (60s — "only needs to
      // live long enough to open the WS connection", see collab_api.py) but
      // y-websocket bakes it into `params` once and reuses that same object
      // for every automatic reconnect it ever makes, for the lifetime of
      // this provider — it never refetches. Left alone, any reconnect more
      // than ~60s after the page loaded (a laptop sleep/wake being the most
      // reliable way to trigger one) fails forever: the server correctly
      // rejects the stale token, and y-websocket has no way to know a fresh
      // one exists, so it just retries the same dead token indefinitely.
      //
      // `provider.url` is a *getter* that re-encodes `provider.params` on
      // every read (see y-websocket's source), so mutating `params.token`
      // in place is enough — the next reconnect attempt (automatic or
      // forced below) picks up whatever token is currently in there.
      const refreshCollabToken = async () => {
        if (cancelled) return;
        const { data: fresh } = await api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
          params: { path: { project_id: projectId, file_id: fileId } },
        });
        if (fresh && !cancelled && provider) provider.params.token = fresh.token;
      };
      tokenRefreshInterval = setInterval(() => void refreshCollabToken(), 40_000);

      // Belt-and-suspenders for the common real-world trigger (laptop
      // sleep/wake, or a backgrounded/throttled tab): as soon as the page
      // is visible/back online again, get a fresh token immediately and,
      // if the socket isn't already connected, force a reconnect right
      // away rather than waiting on y-websocket's own ~30s stale-connection
      // detection before it even tries.
      handleWake = () => {
        void refreshCollabToken().then(() => {
          if (!cancelled && provider && !provider.wsconnected) {
            provider.disconnect();
            provider.connect();
          }
        });
      };
      handleVisibility = () => {
        if (document.visibilityState === "visible") handleWake?.();
      };
      document.addEventListener("visibilitychange", handleVisibility);
      window.addEventListener("online", handleWake);

      const { color, colorLight } = colorForUserId(user?.id ?? "anonymous");
      provider.awareness.setLocalStateField("user", {
        name: user?.display_name || "Anonymous",
        color,
        colorLight,
      });

      const updatePresence = () => {
        const others: PresenceUser[] = [];
        provider!.awareness.getStates().forEach((state, clientId) => {
          if (clientId === ydoc!.clientID) return;
          const info = (state as { user?: { name?: string; color?: string } }).user;
          if (info) others.push({ clientId, name: info.name ?? "Anonymous", color: info.color ?? "#999" });
        });
        setPresence(others);
      };
      provider.awareness.on("change", updatePresence);

      provider.on("status", ({ status: s }: { status: string }) => {
        if (cancelled) return;
        setStatus(s === "connected" ? "live" : "disconnected");
      });

      const onFirstSync = (isSynced: boolean) => {
        if (!isSynced || cancelled) return;
        provider!.off("sync", onFirstSync);

        const state = EditorState.create({
          doc: ytext.toString(),
          extensions: [
            lineNumbers(),
            history(),
            StreamLanguage.define(stex),
            latexSyntaxHighlighting,
            autocompletion({
              override: [
                ...(citeAutocompleteEnabled
                  ? [
                      citeCompletionSource(() => entriesRef.current),
                      refCompletionSource(() => extractLabels(ytext.toString())),
                    ]
                  : []),
                // Environment/package/\includegraphics completion are
                // general LaTeX authoring aids, not citation features —
                // always on, independent of the "Autocomplete suggestions"
                // project setting (which is specifically about
                // \cite{}/\ref{}).
                envCompletionSource(),
                packageCompletionSource(),
                includegraphicsFileCompletionSource(() => imageFilePathsRef.current),
                includegraphicsOptionsCompletionSource(),
              ],
            }),
            keymap.of([
              {
                key: "Mod-s",
                run: () => {
                  onCompileShortcutRef.current?.();
                  return true;
                },
              },
              ...defaultKeymap,
              ...historyKeymap,
              ...completionKeymap,
              ...searchKeymap,
            ]),
            search({ top: true }),
            theme,
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.domEventHandlers({
              paste: (event, view) => {
                const text = event.clipboardData?.getData("text/plain") ?? "";
                if (looksLikeBibtex(text)) {
                  event.preventDefault();
                  const pos = view.state.selection.main.head;
                  void resolveAndCiteRef.current(text, view, pos);
                  return true;
                }
                // Excel/Word both populate text/html on copy with a real
                // <table> carrying the formatting the plain-text clipboard
                // entry throws away — convert it into a real tabular
                // instead of dumping unstructured tab-separated text.
                const html = event.clipboardData?.getData("text/html") ?? "";
                if (looksLikeHtmlTable(html)) {
                  const model = parseHtmlTableToGridModel(html);
                  if (model) {
                    event.preventDefault();
                    const sel = view.state.selection.main;
                    const latex = serializeTabular("tabular", model);
                    view.dispatch({
                      changes: { from: sel.from, to: sel.to, insert: latex },
                      selection: { anchor: sel.from + latex.length },
                      // Same suggestion-tagging discipline as the BibTeX
                      // paste-insert above — a reviewer can't bypass
                      // suggestions by pasting a table instead of typing one.
                      userEvent: "input.paste",
                    });
                    show(`Inserted a ${model.rows.length}×${model.columns.length} table.`);
                    return true;
                  }
                }
                return false;
              },
              drop: (event, view) => {
                const file = event.dataTransfer?.files?.[0];
                if (!file) return false;
                event.preventDefault();
                const pos = view.state.selection.main.head;
                void file.text().then((text) => {
                  if (!looksLikeBibtex(text)) {
                    show("That file doesn't look like BibTeX.", "error");
                    return;
                  }
                  void resolveAndCiteRef.current(text, view, pos);
                });
                return true;
              },
              keydown: () => {
                onKeystrokeRef.current?.();
                return false;
              },
              mousedown: (event, view) => {
                if (event.metaKey || event.ctrlKey) {
                  if (!onJumpToPdfRef.current) return false;
                  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                  if (pos == null) return false;
                  event.preventDefault();
                  onJumpToPdfRef.current(view.state.doc.lineAt(pos).number);
                  return true;
                }
                // Plain click inside a comment's highlighted marked text —
                // report which comment it is, but don't intercept the
                // click, so the cursor still lands there normally too.
                if (onCommentAnchorClickRef.current) {
                  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                  if (pos != null) {
                    const commentId = findCommentAnchorAt(view.state, pos);
                    if (commentId) onCommentAnchorClickRef.current(commentId);
                  }
                }
                return false;
              },
              contextmenu: (event, view) => {
                if (!onAddCommentRef.current) return false;
                const { from, to } = view.state.selection.main;
                if (from === to) return false;
                event.preventDefault();
                setCommentMenu({
                  x: event.clientX,
                  y: event.clientY,
                  from,
                  to,
                  text: view.state.sliceDoc(from, to),
                  line: view.state.doc.lineAt(from).number,
                });
                return true;
              },
            }),
            yCollab(ytext, provider!.awareness, { undoManager: false }),
            EditorView.updateListener.of((update) => {
              if (!update.selectionSet) return;
              onCursorLineChangeRef.current?.(update.state.doc.lineAt(update.state.selection.main.head).number);
            }),
            suggestionDecorationsField,
            suggestionHoverTooltip(
              () => suggestionSpansRef.current,
              () => ytextRef.current!,
              () => canModerateSuggestionsRef.current ?? false,
            ),
            commentAnchorsField,
            polishingLintField,
            tableDesignerGutter((lineNumber) => handleTableGutterClickRef.current(lineNumber)),
            packageDocsGutter((packageName) => handlePackageDocsGutterClickRef.current(packageName)),
          ],
        });

        viewRef.current?.destroy();
        viewRef.current = new EditorView({
          state,
          parent: hostRef.current!,
          // Reviewing mode / reviewer role: rewrite local edits into tracked
          // suggestions instead of direct writes before they ever reach
          // yCollab's own mirroring — see suggestionRewrite.ts for why a
          // deletion becomes "keep the text, tag it" rather than an actual
          // removal, and CodeMirrorEditor.module.css / suggestionsExtension.ts
          // for how that's then rendered and resolved.
          dispatchTransactions: (trs, view) => {
            if (!suggestModeRef.current) {
              view.update(trs);
              // Real bug: Yjs's Y.Text auto-inherits the *preceding* run's
              // rich-text attributes for a plain insert with none of its
              // own (the same Quill-delta-compatible behavior
              // ensureSuggestionTag's own doc comment already relies on,
              // in the opposite direction) — so typing right after (or
              // inside) a suggestion made earlier while Reviewing would
              // silently inherit its `sugg` tag even after switching back
              // to Writing, making new edits look like they're still being
              // tracked. yCollab mirrors a plain CodeMirror transaction
              // into Y.Text synchronously within view.update() (same
              // assumption the suggest-mode branch below already makes,
              // calling ensureSuggestionTag right after its own
              // view.update()), so by this point the insertion already
              // landed — explicitly clear any inherited suggestion attrs
              // on exactly what was just typed. Uses `toB` (the position in
              // *this transaction's own resulting document*) directly
              // rather than re-deriving it from `fromA`/`toA`, unlike
              // planSuggestionRewrite below — that function computes a
              // *different* resulting document (deletions suppressed, so
              // its own position bookkeeping is necessary); this branch
              // applies `trs` completely unchanged via `view.update(trs)`
              // above, so CodeMirror's own `toB` is already exactly right,
              // including correctly chaining across more than one
              // transaction in a single dispatch (each transaction's `toB`
              // is relative to *its own* start state, i.e. the previous
              // transaction's result) — no manual cross-transaction
              // position tracking needed, and none to get wrong.
              const yt = ytextRef.current;
              if (yt) {
                for (const tr of trs) {
                  if (!tr.docChanged) continue;
                  tr.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
                    if (inserted.length > 0) yt.format(fromB, inserted.length, CLEAR_SUGGESTION_ATTRS);
                  });
                }
              }
              return;
            }
            const rewritten: Transaction[] = [];
            const formatOps: { kind: "ins" | "del"; from: number; to: number }[] = [];
            // Snapshot once per dispatch (not per transaction): still-pending
            // insertions get actually deleted rather than double-tagged when
            // removed before anyone accepts them — see splitDeletionRange's
            // doc comment in suggestionRewrite.ts.
            const pendingInsertions = ytextRef.current
              ? computeSuggestionSpans(ytextRef.current)
                  .filter((s) => s.kind === "ins")
                  .map((s) => ({ from: s.from, to: s.to }))
              : [];
            for (const tr of trs) {
              if (isSuggestableEdit(tr)) {
                const plan = planSuggestionRewrite(tr, pendingInsertions);
                if (plan.changes) {
                  const spec: TransactionSpec = { changes: plan.changes, scrollIntoView: tr.scrollIntoView };
                  if (plan.selectionAnchor != null) spec.selection = { anchor: plan.selectionAnchor };
                  rewritten.push(tr.startState.update(spec));
                  formatOps.push(...plan.formatOps);
                  continue;
                }
              }
              rewritten.push(tr);
            }
            view.update(rewritten);
            const yt = ytextRef.current;
            if (formatOps.length > 0 && yt) {
              const authorId = user?.id ?? "anonymous";
              const authorName = user?.display_name || "Anonymous";
              const now = Date.now();
              for (const op of formatOps) ensureSuggestionTag(yt, op.from, op.to, op.kind, authorId, authorName, now);
            }
          },
        });
        setLoading(false);
        recomputeSuggestionsRef.current();
        recomputePolishingLintRef.current();
        recomputeCommentAnchorsRef.current();
        onDocTextChangeRef.current?.(ytext.toString());

        // Only schedule auto-compile for changes *after* the initial content
        // sync — otherwise just opening the file would trigger a compile.
        ydoc!.on("update", () => {
          onActivityRef.current?.();
          if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
          changeTimerRef.current = setTimeout(() => onContentChangedRef.current?.(), 1500);
          if (docTextChangeTimerRef.current) clearTimeout(docTextChangeTimerRef.current);
          docTextChangeTimerRef.current = setTimeout(() => onDocTextChangeRef.current?.(ytext.toString()), 400);
          // Deferred: this fires *during* yCollab's own transaction application
          // (Yjs's "update" event is emitted mid-transact, itself nested inside
          // a CodeMirror view.update() call), so dispatching another transaction
          // synchronously here hits CodeMirror's re-entrancy guard ("Calls to
          // EditorView.update are not allowed while an update is in progress").
          setTimeout(() => {
            recomputeSuggestionsRef.current();
            recomputePolishingLintRef.current();
          }, 0);
        });
      };
      provider.on("sync", onFirstSync);
    })();

    return () => {
      cancelled = true;
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
      if (docTextChangeTimerRef.current) clearTimeout(docTextChangeTimerRef.current);
      if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
      if (handleVisibility) document.removeEventListener("visibilitychange", handleVisibility);
      if (handleWake) window.removeEventListener("online", handleWake);
      viewRef.current?.destroy();
      viewRef.current = null;
      ytextRef.current = null;
      provider?.destroy();
      ydoc?.destroy();
    };
  }, [projectId, fileId, readOnly, user?.id, user?.display_name]);

  // Applies a pending "jump to this line" request (from clicking in the PDF)
  // once the editor view is ready. Depends on `loading` too so a jump that
  // arrives together with a file switch (view not yet created) is retried
  // once the new view finishes its initial Yjs sync.
  useEffect(() => {
    if (loading || !jumpTarget || !viewRef.current) return;
    const view = viewRef.current;
    const lineNum = Math.max(1, Math.min(jumpTarget.line, view.state.doc.lines));
    const line = view.state.doc.line(lineNum);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }, [jumpTarget, loading]);

  // Recomputes lint findings when Polishing mode is toggled on/off.
  useEffect(() => {
    if (loading) return;
    recomputePolishingLintRef.current();
  }, [polishingEnabled, loading]);

  // Recomputes comment-anchor highlights when the comment list changes
  // (loaded, added, resolved, deleted). Edits to the document itself don't
  // need a recompute — CodeMirror's own decoration mapping moves existing
  // marked ranges as the surrounding text changes.
  useEffect(() => {
    if (loading) return;
    recomputeCommentAnchorsRef.current();
  }, [commentAnchors, loading]);

  // Dismisses the "Add comment" popup on outside click, Escape, or scroll.
  useEffect(() => {
    if (!commentMenu) return;
    const dismiss = () => setCommentMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const scroller = hostRef.current?.querySelector(".cm-scroller");
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    scroller?.addEventListener("scroll", dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", dismiss);
    };
  }, [commentMenu]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.statusBar}>
        <PresenceRow users={presence} />
        <ConnectionStatusPill status={status} />
      </div>
      <div className={styles.editorHost} ref={hostRef} />
      {loading && (
        <div className={styles.loadingOverlay}>
          <Spinner />
        </div>
      )}
      {dupModal && (
        <DuplicateDialog existing={dupModal.existing} incoming={dupModal.incoming} onResolve={dupModal.resolve} />
      )}
      {commentMenu && (
        <div
          className={styles.commentMenu}
          style={{ left: commentMenu.x, top: commentMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={styles.commentMenuItem}
            onClick={() => {
              onAddCommentRef.current?.({
                from: commentMenu.from,
                to: commentMenu.to,
                text: commentMenu.text,
                line: commentMenu.line,
              });
              setCommentMenu(null);
            }}
          >
            <MessageSquarePlus size={14} aria-hidden="true" />
            Add comment
          </button>
        </div>
      )}
    </div>
  );
});

function ConnectionStatusPill({ status }: { status: ConnectionStatus }) {
  const label = { connecting: "Connecting…", live: "Live", disconnected: "Reconnecting…" }[status];
  return <span className={[styles.status, styles[status]].join(" ")}>{label}</span>;
}

function PresenceRow({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;
  return (
    <div className={styles.presence} title={users.map((u) => u.name).join(", ")}>
      {users.map((u) => (
        <span key={u.clientId} className={styles.presenceDot} style={{ backgroundColor: u.color }}>
          {u.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
