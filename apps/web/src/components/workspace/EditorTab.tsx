import { api, apiOrigin } from "@freeleaf/shared";
import { FileQuestion } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EmptyState } from "../ui/EmptyState";
import { useWorkspace } from "../../lib/workspace";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { JumpTarget } from "./CodeMirrorEditor";
import { CompilePane } from "./CompilePane";
import type { CompilePaneHandle } from "./CompilePane";
import { SplitPane } from "./SplitPane";
import styles from "./EditorTab.module.css";

// Automated version-history checkpoints (Plan.md §9 Phase 8): a snapshot
// after 5 minutes of no edits, or every 1000 keystrokes, whichever comes
// first. The backend dedupes identical-content auto-snapshots on its own,
// but a client-side minimum gap avoids firing both triggers in a burst.
const INACTIVITY_SNAPSHOT_MS = 5 * 60 * 1000;
const KEYSTROKE_SNAPSHOT_THRESHOLD = 1000;
const MIN_AUTO_SNAPSHOT_GAP_MS = 60 * 1000;

export function EditorTab() {
  const { projectId, files, selectedFileId, selectFile, canWrite } = useWorkspace();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const compilePaneRef = useRef<CompilePaneHandle>(null);
  const jumpTokenRef = useRef(0);
  const [jump, setJump] = useState<{ fileId: string } & JumpTarget | null>(null);

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
      body: { kind: "auto" },
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
          <div className={styles.paneHeader} title="Cmd/Ctrl+click text to jump to that spot in the PDF">
            {selectedFile.path}
          </div>
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
            />
          </div>
        </div>
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
