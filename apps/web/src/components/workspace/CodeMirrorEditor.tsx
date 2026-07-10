import { api, apiOrigin } from "@freeleaf/shared";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "../ui/Spinner";
import styles from "./CodeMirrorEditor.module.css";

type SaveStatus = "idle" | "saved" | "saving" | "unsaved" | "error";

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

export function CodeMirrorEditor({
  projectId,
  fileId,
  readOnly,
  onSaved,
}: {
  projectId: string;
  fileId: string;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  async function save() {
    const view = viewRef.current;
    if (!view) return;
    setStatus("saving");
    const { error } = await api.PUT("/api/projects/{project_id}/files/{file_id}/content", {
      params: { path: { project_id: projectId, file_id: fileId } },
      body: { content: view.state.doc.toString() },
    });
    setStatus(error ? "error" : "saved");
    if (!error) onSavedRef.current?.();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus("idle");

    (async () => {
      const res = await fetch(
        `${apiOrigin()}/api/projects/${projectId}/files/${fileId}/content`,
        { credentials: "include" },
      );
      const text = res.ok ? await res.text() : "";
      if (cancelled) return;

      const state = EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          history(),
          StreamLanguage.define(stex),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                save();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          theme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setStatus("unsaved");
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
              saveTimerRef.current = setTimeout(save, 1500);
            }
          }),
        ],
      });

      viewRef.current?.destroy();
      viewRef.current = new EditorView({ state, parent: hostRef.current! });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [projectId, fileId, readOnly]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.statusBar}>
        <SaveStatusIndicator status={status} />
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

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const label = {
    saving: "Saving…",
    saved: "Saved",
    unsaved: "Unsaved changes",
    error: "Couldn't save",
  }[status];
  return <span className={[styles.status, styles[status]].join(" ")}>{label}</span>;
}
