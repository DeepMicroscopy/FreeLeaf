import { api, looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { yCollab } from "y-codemirror.next";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../lib/auth";
import { useBibliography } from "../../lib/bibliography";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { citeCompletionSource } from "./citeCompletion";
import type { DuplicateChoice } from "./DuplicateDialog";
import { DuplicateDialog } from "./DuplicateDialog";
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
}: {
  projectId: string;
  fileId: string;
  readOnly: boolean;
  onContentChanged?: () => void;
  onCompileShortcut?: () => void;
  onJumpToPdf?: (line: number) => void;
  onActivity?: () => void;
  onKeystroke?: () => void;
  jumpTarget?: JumpTarget;
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
            ...(citeAutocompleteEnabled
              ? [autocompletion({ override: [citeCompletionSource(() => entriesRef.current)] })]
              : []),
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
              ...(citeAutocompleteEnabled ? completionKeymap : []),
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
                if (!(event.metaKey || event.ctrlKey) || !onJumpToPdfRef.current) return false;
                const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (pos == null) return false;
                event.preventDefault();
                onJumpToPdfRef.current(view.state.doc.lineAt(pos).number);
                return true;
              },
            }),
            yCollab(ytext, provider!.awareness, { undoManager: false }),
          ],
        });

        viewRef.current?.destroy();
        viewRef.current = new EditorView({ state, parent: hostRef.current! });
        setLoading(false);

        // Only schedule auto-compile for changes *after* the initial content
        // sync — otherwise just opening the file would trigger a compile.
        ydoc!.on("update", () => {
          onActivityRef.current?.();
          if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
          changeTimerRef.current = setTimeout(() => onContentChangedRef.current?.(), 1500);
        });
      };
      provider.on("sync", onFirstSync);
    })();

    return () => {
      cancelled = true;
      if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
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
