import { api, apiOrigin } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { FileQuestion, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/Toast";
import { useEditingMode } from "../../lib/editingMode";
import { useWorkspace } from "../../lib/workspace";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { JumpTarget } from "./CodeMirrorEditor";
import { CommentsPane } from "./CommentsPane";
import { CompilePane } from "./CompilePane";
import type { CompilePaneHandle } from "./CompilePane";
import { ModeSwitcher } from "./ModeSwitcher";
import type { LintFinding } from "./polishingLint";
import { SplitPane } from "./SplitPane";
import { serializeTabular } from "./tableDesigner";
import type { TabularMatch, TableGridModel } from "./tableDesigner";
import { TableDesignerDialog } from "./TableDesignerDialog";
import styles from "./EditorTab.module.css";

type SnapshotOut = components["schemas"]["SnapshotOut"];
type CompileRunOut = components["schemas"]["CompileRunOut"];

interface PolishingFinding {
  key: string;
  line: number | null;
  message: string;
  tone: "error" | "warning" | "lint";
}

// Automated version-history checkpoints (Plan.md §9 Phase 8): a snapshot
// after 5 minutes of no edits, or every 1000 keystrokes, whichever comes
// first. The backend dedupes identical-content auto-snapshots on its own,
// but a client-side minimum gap avoids firing both triggers in a burst.
const INACTIVITY_SNAPSHOT_MS = 5 * 60 * 1000;
const KEYSTROKE_SNAPSHOT_THRESHOLD = 1000;
const MIN_AUTO_SNAPSHOT_GAP_MS = 60 * 1000;

export function EditorTab() {
  const { projectId, files, selectedFileId, selectFile, canWrite, refreshFiles } = useWorkspace();
  const { mode } = useEditingMode();
  const { show } = useToast();
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

  // Reviewing mode's track-changes diff (Plan.md §9 Phase 8): diffs the live
  // file against a chosen snapshot "baseline" — see trackChangesExtension.ts
  // for why this, not per-keystroke CRDT attribution, was the scoped-down
  // approach here.
  const [snapshots, setSnapshots] = useState<SnapshotOut[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [baselineContent, setBaselineContent] = useState<string | null>(null);
  const [trackChangesBusy, setTrackChangesBusy] = useState(false);

  const loadSnapshots = useCallback(async () => {
    const { data } = await api.GET("/api/projects/{project_id}/snapshots", {
      params: { path: { project_id: projectId } },
    });
    const list = data ?? [];
    setSnapshots(list);
    setBaselineId((prev) => (prev && list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? null)));
  }, [projectId]);

  useEffect(() => {
    if (mode !== "reviewing") return;
    void loadSnapshots();
  }, [mode, loadSnapshots]);

  useEffect(() => {
    if (mode !== "reviewing" || !baselineId || !selectedFile) {
      setBaselineContent(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await api.GET("/api/projects/{project_id}/snapshots/{snapshot_id}/file-content", {
        params: { path: { project_id: projectId, snapshot_id: baselineId }, query: { path: selectedFile.path } },
      });
      if (!cancelled) setBaselineContent(data?.content ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, baselineId, projectId, selectedFile]);

  const handleMarkNewBaseline = useCallback(async () => {
    setTrackChangesBusy(true);
    const { data } = await api.POST("/api/projects/{project_id}/snapshots", {
      params: { path: { project_id: projectId } },
      body: { kind: "manual", label: "Reviewing baseline", description: "" },
    });
    setTrackChangesBusy(false);
    if (data) {
      show("Current state marked as the new baseline.");
      await loadSnapshots();
      setBaselineId(data.id);
    }
  }, [projectId, show, loadSnapshots]);

  const handleRevertToBaseline = useCallback(async () => {
    if (!baselineId) return;
    setTrackChangesBusy(true);
    const { data } = await api.POST("/api/projects/{project_id}/snapshots/{snapshot_id}/restore", {
      params: { path: { project_id: projectId, snapshot_id: baselineId } },
    });
    setTrackChangesBusy(false);
    if (data) {
      show("Reverted to the baseline. A backup of the previous state was saved automatically.");
      await refreshFiles();
      await loadSnapshots();
    }
  }, [projectId, baselineId, show, refreshFiles, loadSnapshots]);

  // Polishing mode's aggressively-surfaced checks (Plan.md §9 Phase 8):
  // static lint findings (polishingLint.ts) plus the most recent compile
  // run's already-parsed errors/warnings, merged into one list.
  const [lintFindings, setLintFindings] = useState<LintFinding[]>([]);
  const [latestRun, setLatestRun] = useState<CompileRunOut | null>(null);

  const polishingFindings: PolishingFinding[] =
    mode === "polishing"
      ? [
          ...lintFindings.map((f, i) => ({ key: `lint-${i}`, line: f.line, message: f.message, tone: "lint" as const })),
          ...(latestRun?.errors ?? [])
            .filter((d) => !d.file || d.file === selectedFile?.path)
            .map((d, i) => ({ key: `err-${i}`, line: d.line ?? null, message: d.message, tone: "error" as const })),
          ...(latestRun?.warnings ?? [])
            .filter((d) => !d.file || d.file === selectedFile?.path)
            .map((d, i) => ({ key: `warn-${i}`, line: d.line ?? null, message: d.message, tone: "warning" as const })),
        ]
      : [];

  // Table Designer (Plan.md §9 Phase 10): opened from a gutter icon inside
  // CodeMirrorEditor, which does the actual tabular parsing (it owns the
  // live document) and hands back the parsed match plus a scoped `applyEdit`
  // that re-verifies the target range is unchanged before writing.
  const [tableDesigner, setTableDesigner] = useState<{
    match: TabularMatch;
    applyEdit: (newText: string) => boolean;
  } | null>(null);

  const handleOpenTableDesigner = useCallback(
    (match: TabularMatch, applyEdit: (newText: string) => boolean) => {
      if (!match.supported) {
        show(`This table isn't editable here: ${match.reason}`, "error");
        return;
      }
      setTableDesigner({ match, applyEdit });
    },
    [show],
  );

  const handleSaveTable = useCallback(
    (newModel: TableGridModel) => {
      if (!tableDesigner) return;
      const newText = serializeTabular(tableDesigner.match.envName, newModel);
      const ok = tableDesigner.applyEdit(newText);
      setTableDesigner(null);
      show(
        ok
          ? "Table updated."
          : "This table changed elsewhere while you were editing — please reopen the Table Designer.",
        ok ? "default" : "error",
      );
    },
    [tableDesigner, show],
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
    <>
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
          {mode === "polishing" && (
            <div className={styles.polishingPanel}>
              {polishingFindings.length === 0 ? (
                <div className={styles.polishingEmpty}>No issues found — nice and clean.</div>
              ) : (
                <ul className={styles.polishingList}>
                  {polishingFindings.map((f) => (
                    <li key={f.key} className={[styles.polishingItem, styles[`polishing-${f.tone}`]].join(" ")}>
                      {f.line != null ? (
                        <button className={styles.polishingLine} onClick={() => handleJumpToLine(f.line!)}>
                          L{f.line}
                        </button>
                      ) : (
                        <span className={styles.polishingLine}>—</span>
                      )}
                      <span className={styles.polishingMessage}>{f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {mode === "reviewing" && (
            <div className={styles.trackChangesBar}>
              {snapshots.length === 0 ? (
                <span className={styles.trackChangesHint}>
                  No saved version yet to compare against —{" "}
                  <button className={styles.trackChangesLink} onClick={handleMarkNewBaseline} disabled={trackChangesBusy}>
                    save one now
                  </button>{" "}
                  to start tracking changes.
                </span>
              ) : (
                <>
                  <span className={styles.trackChangesHint}>Comparing against:</span>
                  <select
                    className={styles.baselineSelect}
                    value={baselineId ?? ""}
                    onChange={(e) => setBaselineId(e.target.value)}
                  >
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {(s.label || (s.kind === "manual" ? "Named" : "Automatic")) + " · " + new Date(s.created_at).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  {canWrite && (
                    <>
                      <Button variant="secondary" size="sm" onClick={handleMarkNewBaseline} loading={trackChangesBusy}>
                        Mark current as new baseline
                      </Button>
                      <Button variant="danger" size="sm" onClick={handleRevertToBaseline} loading={trackChangesBusy}>
                        Revert project to baseline
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
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
              trackChangesBaseline={mode === "reviewing" ? baselineContent : null}
              polishingEnabled={mode === "polishing"}
              onLintFindings={setLintFindings}
              onOpenTableDesigner={handleOpenTableDesigner}
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
                onRunChanged={setLatestRun}
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
    {tableDesigner && (
      <TableDesignerDialog
        envName={tableDesigner.match.envName}
        model={tableDesigner.match.model!}
        onSave={handleSaveTable}
        onCancel={() => setTableDesigner(null)}
      />
    )}
    </>
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
