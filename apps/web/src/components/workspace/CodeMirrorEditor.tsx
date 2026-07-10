import { api, looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
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

export function CodeMirrorEditor({
  projectId,
  fileId,
  readOnly,
  onContentChanged,
}: {
  projectId: string;
  fileId: string;
  readOnly: boolean;
  onContentChanged?: () => void;
}) {
  const { user } = useAuth();
  const { entries, addEntries } = useBibliography();
  const { show } = useToast();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContentChangedRef = useRef(onContentChanged);
  onContentChangedRef.current = onContentChanged;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const importBibtexRef = useRef((_text: string) => {});
  importBibtexRef.current = (text: string) => {
    const parsed = parseBibtex(text);
    if (parsed.length === 0) {
      show("No BibTeX entries found in that content.", "error");
      return;
    }
    const { added, conflicts } = addEntries(parsed);
    if (added.length > 0) {
      const suffix = conflicts.length > 0 ? `, ${conflicts.length} duplicate key(s) skipped` : "";
      show(`Added ${added.length} reference${added.length === 1 ? "" : "s"}${suffix}.`);
    } else if (conflicts.length > 0) {
      show(`All ${conflicts.length} entries were already in the library — nothing added.`, "error");
    }
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
      const { data } = await api.GET("/api/projects/{project_id}/files/{file_id}/collab-token", {
        params: { path: { project_id: projectId, file_id: fileId } },
      });
      if (!data || cancelled) return;

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
            autocompletion({ override: [citeCompletionSource(() => entriesRef.current)] }),
            keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
            theme,
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.domEventHandlers({
              paste: (event) => {
                const text = event.clipboardData?.getData("text/plain") ?? "";
                if (!looksLikeBibtex(text)) return false;
                event.preventDefault();
                importBibtexRef.current(text);
                return true;
              },
              drop: (event) => {
                const file = event.dataTransfer?.files?.[0];
                if (!file) return false;
                event.preventDefault();
                void file.text().then((text) => {
                  if (!looksLikeBibtex(text)) {
                    show("That file doesn't look like BibTeX.", "error");
                    return;
                  }
                  importBibtexRef.current(text);
                });
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
