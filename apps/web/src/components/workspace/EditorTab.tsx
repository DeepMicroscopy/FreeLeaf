import { api, apiOrigin } from "@freeleaf/shared";
import { FileQuestion, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useEditingMode } from "../../lib/editingMode";
import { useWorkspace } from "../../lib/workspace";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { JumpTarget } from "./CodeMirrorEditor";
import { CommentsPane } from "./CommentsPane";
import { CompilePane } from "./CompilePane";
import type { CompilePaneHandle } from "./CompilePane";
import { ModeSwitcher } from "./ModeSwitcher";
import { SplitPane } from "./SplitPane";
import styles from "./EditorTab.module.css";

const MODE_BANNERS: Record<"reviewing" | "polishing", string> = {
  reviewing: "Reviewing mode: track changes aren't implemented yet — edits apply directly, just like Writing mode.",
  polishing: "Polishing mode: the aggressive linter isn't implemented yet — edits apply directly, just like Writing mode.",
};

// Automated version-history checkpoints (Plan.md §9 Phase 8): a snapshot
// after 5 minutes of no edits, or every 1000 keystrokes, whichever comes
// first. The backend dedupes identical-content auto-snapshots on its own,
// but a client-side minimum gap avoids firing both triggers in a burst.
const INACTIVITY_SNAPSHOT_MS = 5 * 60 * 1000;
const KEYSTROKE_SNAPSHOT_THRESHOLD = 1000;
const MIN_AUTO_SNAPSHOT_GAP_MS = 60 * 1000;

export function EditorTab() {
  const { projectId, files, selectedFileId, selectFile, canWrite } = useWorkspace();
  const { mode } = useEditingMode();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const compilePaneRef = useRef<CompilePaneHandle>(null);
  const jumpTokenRef = useRef(0);
  const [jump, setJump] = useState<{ fileId: string } & JumpTarget | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [showComments, setShowComments] = useState(
    () => localStorage.getItem(`freeleaf.showComments.${projectId}`) === "1",
  );

  const toggleComments = useCallback(() => {
    setShowComments((prev) => {
      const next = !prev;
      localStorage.setItem(`freeleaf.showComments.${projectId}`, next ? "1" : "0");
      return next;
    });
  }, [projectId]);

  const handleJumpToLine = useCallback(
    (line: number) => {
      if (!selectedFile) return;
      jumpTokenRef.current += 1;
      setJump({ fileId: selectedFile.id, line, token: jumpTokenRef.current });
    },
    [selectedFile],
  );

  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keystrokeCountRef = useRef(0);
  const lastAutoSnapshotAtRef = useRef(0);

  const triggerAutoSnapshot = useCallback(() => {
    const now = Date.now();
    if (now - lastAutoSnapshotAtRef.current < MIN_AUTO_SNAPSHOT_GAP_MS) return;
    lastAutoSnapshotAtRef.current = now;
    keystrokeCountRef.current = 0;
    void api.POST("/api/projects/{project_id}/snapshots", {
      params: { path: { project_id: projectId } },
      body: { kind: "auto", label: "", description: "" },
    });
  }, [projectId]);

  const handleActivity = useCallback(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(triggerAutoSnapshot, INACTIVITY_SNAPSHOT_MS);
  }, [triggerAutoSnapshot]);

  const handleKeystroke = useCallback(() => {
    keystrokeCountRef.current += 1;
    if (keystrokeCountRef.current >= KEYSTROKE_SNAPSHOT_THRESHOLD) triggerAutoSnapshot();
  }, [triggerAutoSnapshot]);

  useEffect(() => {
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, []);
  const handleContentChanged = useCallback(() => {
    compilePaneRef.current?.scheduleAutoCompile();
  }, []);
  const handleCompileShortcut = useCallback(() => {
    compilePaneRef.current?.triggerCompile();
  }, []);
  const handleJumpToPdf = useCallback(
    (line: number) => {
      if (!selectedFile) return;
      void compilePaneRef.current?.jumpToPdf(selectedFile.path, line);
    },
    [selectedFile],
  );
  const handleJumpToSource = useCallback(
    (file: string, line: number) => {
      const target = files.find((f) => f.path === file);
      if (!target) return;
      jumpTokenRef.current += 1;
      setJump({ fileId: target.id, line, token: jumpTokenRef.current });
      if (target.id !== selectedFileId) selectFile(target.id);
    },
    [files, selectedFileId, selectFile],
  );

  if (!selectedFile) {
    return (
      <EmptyState
        icon={<FileQuestion size={32} aria-hidden="true" />}
        title="No file selected"
        description="Choose a file from the sidebar to start editing."
      />
    );
  }

  if (selectedFile.type === "image") {
    return <ImagePreviewPane projectId={projectId} fileId={selectedFile.id} name={selectedFile.path} />;
  }

  return (
    <SplitPane
      storageKey="freeleaf.editor.split"
      left={
        <div className={styles.pane}>
          <div className={styles.paneHeader}>
            <span className={styles.panePath} title="Cmd/Ctrl+click text to jump to that spot in the PDF">
              {selectedFile.path}
            </span>
            <div className={styles.paneHeaderActions}>
              <ModeSwitcher />
              <Button
                variant={showComments ? "secondary" : "ghost"}
                size="sm"
                onClick={toggleComments}
                title="Toggle comments pane"
              >
                <MessageSquare size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
          {mode !== "writing" && <div className={styles.modeBanner}>{MODE_BANNERS[mode]}</div>}
          <div className={styles.paneBody}>
            <CodeMirrorEditor
              projectId={projectId}
              fileId={selectedFile.id}
              readOnly={!canWrite}
              onContentChanged={handleContentChanged}
              onCompileShortcut={handleCompileShortcut}
              onJumpToPdf={handleJumpToPdf}
              jumpTarget={jump && jump.fileId === selectedFile.id ? jump : undefined}
              onActivity={canWrite ? handleActivity : undefined}
              onKeystroke={canWrite ? handleKeystroke : undefined}
              onCursorLineChange={setCursorLine}
            />
          </div>
        </div>
      }
      right={
        showComments ? (
          <SplitPane
            storageKey="freeleaf.editor.commentsSplit"
            defaultRatio={0.32}
            left={
              <CommentsPane
                projectId={projectId}
                fileId={selectedFile.id}
                canResolve={canWrite}
                currentLine={cursorLine}
                onJumpToLine={handleJumpToLine}
              />
            }
            right={
              <CompilePane
                ref={compilePaneRef}
                projectId={projectId}
                canWrite={canWrite}
                onJumpToSource={handleJumpToSource}
              />
            }
          />
        ) : (
          <CompilePane
            ref={compilePaneRef}
            projectId={projectId}
            canWrite={canWrite}
            onJumpToSource={handleJumpToSource}
          />
        )
      }
    />
  );
}

function ImagePreviewPane({ projectId, fileId, name }: { projectId: string; fileId: string; name: string }) {
  const src = `${apiOrigin()}/api/projects/${projectId}/files/${fileId}/content`;
  return (
    <div className={styles.pane}>
      <div className={styles.paneHeader}>{name}</div>
      <div className={styles.imageBody}>
        <img src={src} alt={name} className={styles.image} />
      </div>
    </div>
  );
}
