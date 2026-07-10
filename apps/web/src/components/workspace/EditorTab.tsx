import { apiOrigin } from "@freeleaf/shared";
import { FileQuestion } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { EmptyState } from "../ui/EmptyState";
import { useWorkspace } from "../../lib/workspace";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { JumpTarget } from "./CodeMirrorEditor";
import { CompilePane } from "./CompilePane";
import type { CompilePaneHandle } from "./CompilePane";
import { SplitPane } from "./SplitPane";
import styles from "./EditorTab.module.css";

export function EditorTab() {
  const { projectId, files, selectedFileId, selectFile, canWrite } = useWorkspace();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const compilePaneRef = useRef<CompilePaneHandle>(null);
  const jumpTokenRef = useRef(0);
  const [jump, setJump] = useState<{ fileId: string } & JumpTarget | null>(null);
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
