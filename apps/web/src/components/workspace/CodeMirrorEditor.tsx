import { api, looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { MessageSquarePlus } from "lucide-react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../lib/auth";
import { useBibliography } from "../../lib/bibliography";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { citeCompletionSource } from "./citeCompletion";
import { envCompletionSource } from "./envCompletion";
import { packageCompletionSource } from "./packageCompletion";
import { extractLabels, refCompletionSource } from "./refCompletion";
import type { DuplicateChoice } from "./DuplicateDialog";
import { DuplicateDialog } from "./DuplicateDialog";
import { lintLatex } from "./polishingLint";
import type { LintFinding } from "./polishingLint";
import { findTabularEnvironments } from "./tableDesigner";
import type { TabularMatch } from "./tableDesigner";
import { tableDesignerGutter } from "./tableDesignerGutter";
import {
  computePolishingLintDecorations,
  polishingLintField,
  setPolishingLintDecorations,
} from "./polishingLintExtension";
import { computeTrackChangesDecorations, setTrackChangesDecorations, trackChangesField } from "./trackChangesExtension";
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
  ".cm-trackInsert": {
    backgroundColor: "color-mix(in srgb, #22c55e 20%, transparent)",
    textDecoration: "underline",
    textDecorationColor: "#22c55e",
  },
  ".cm-trackDelete": {
    backgroundColor: "color-mix(in srgb, #ef4444 18%, transparent)",
    textDecoration: "line-through",
    textDecorationColor: "#ef4444",
    opacity: 0.75,
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
});

function colorForUserId(id: string): { color: string; colorLight: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return { color: `hsl(${hue} 70% 45%)`, colorLight: `hsl(${hue} 70% 45% / 0.25)` };
}

export interface JumpTarget {
  line: number;
  token: number;
}

export function CodeMirrorEditor({
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
  trackChangesBaseline,
  polishingEnabled,
  onLintFindings,
  onOpenTableDesigner,
  commentAnchors,
  onAddComment,
  onCommentAnchorClick,
}: {
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
  /** Reviewing mode's diff-since-baseline (Plan.md §9 Phase 8) — raw text
   * content of the chosen snapshot to diff the live document against. Null
   * means "don't show track-changes markup" (Writing/Polishing mode, or no
   * baseline picked yet). */
  trackChangesBaseline?: string | null;
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
}) {
  const { user } = useAuth();
  const { entries, addEntries, findNearDuplicate, findByKey } = useBibliography();
  const { show } = useToast();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const trackChangesBaselineRef = useRef(trackChangesBaseline);
  trackChangesBaselineRef.current = trackChangesBaseline;
  const recomputeTrackChangesRef = useRef(() => {});
  recomputeTrackChangesRef.current = () => {
    const view = viewRef.current;
    const baseline = trackChangesBaselineRef.current;
    if (!view) return;
    const decorations =
      baseline == null ? Decoration.none : computeTrackChangesDecorations(baseline, view.state.doc.toString());
    view.dispatch({ effects: setTrackChangesDecorations.of(decorations) });
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
    const decorations = computeCommentAnchorDecorations(commentAnchorsRef.current ?? [], view.state.doc.length);
    view.dispatch({ effects: setCommentAnchorDecorations.of(decorations) });
  };
  const onCommentAnchorClickRef = useRef(onCommentAnchorClick);
  onCommentAnchorClickRef.current = onCommentAnchorClick;
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  const [commentMenu, setCommentMenu] = useState<{ x: number; y: number; from: number; to: number; text: string; line: number } | null>(null);
  const onOpenTableDesignerRef = useRef(onOpenTableDesigner);
  onOpenTableDesignerRef.current = onOpenTableDesigner;
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
      liveView.dispatch({ changes: { from: match.from, to: match.to, insert: newText } });
      return true;
    });
  };
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
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
            autocompletion({
              override: [
                ...(citeAutocompleteEnabled
                  ? [
                      citeCompletionSource(() => entriesRef.current),
                      refCompletionSource(() => extractLabels(ytext.toString())),
                    ]
                  : []),
                // Environment and package completion (\begin{...},
                // \usepackage{...}) are general LaTeX authoring aids, not
                // citation features — always on, independent of the
                // "Autocomplete suggestions" project setting (which is
                // specifically about \cite{}/\ref{}).
                envCompletionSource(),
                packageCompletionSource(),
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
            ]),
            theme,
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.domEventHandlers({
              paste: (event, view) => {
                const text = event.clipboardData?.getData("text/plain") ?? "";
                if (!looksLikeBibtex(text)) return false;
                event.preventDefault();
                const pos = view.state.selection.main.head;
                void resolveAndCiteRef.current(text, view, pos);
                return true;
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
            trackChangesField,
            commentAnchorsField,
            polishingLintField,
            tableDesignerGutter((lineNumber) => handleTableGutterClickRef.current(lineNumber)),
          ],
        });

        viewRef.current?.destroy();
        viewRef.current = new EditorView({ state, parent: hostRef.current! });
        setLoading(false);
        recomputeTrackChangesRef.current();
        recomputePolishingLintRef.current();
        recomputeCommentAnchorsRef.current();

        // Only schedule auto-compile for changes *after* the initial content
        // sync — otherwise just opening the file would trigger a compile.
        ydoc!.on("update", () => {
          onActivityRef.current?.();
          if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
          changeTimerRef.current = setTimeout(() => onContentChangedRef.current?.(), 1500);
          // Deferred: this fires *during* yCollab's own transaction application
          // (Yjs's "update" event is emitted mid-transact, itself nested inside
          // a CodeMirror view.update() call), so dispatching another transaction
          // synchronously here hits CodeMirror's re-entrancy guard ("Calls to
          // EditorView.update are not allowed while an update is in progress").
          setTimeout(() => {
            recomputeTrackChangesRef.current();
            recomputePolishingLintRef.current();
          }, 0);
        });
      };
      provider.on("sync", onFirstSync);
    })();

    return () => {
      cancelled = true;
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
      if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
      if (handleVisibility) document.removeEventListener("visibilitychange", handleVisibility);
      if (handleWake) window.removeEventListener("online", handleWake);
      viewRef.current?.destroy();
      viewRef.current = null;
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

  // Recomputes track-changes markup when the chosen baseline changes (e.g.
  // the user picks a different snapshot to compare against) without a
  // content edit having happened — the ydoc "update" listener above only
  // covers the other direction (content changed, baseline unchanged).
  useEffect(() => {
    if (loading) return;
    recomputeTrackChangesRef.current();
  }, [trackChangesBaseline, loading]);

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
}

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
