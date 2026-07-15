import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { FileQuestion, MessageSquare, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useToast } from "../ui/Toast";
import { useEditingMode } from "../../lib/editingMode";
import { useWorkspace } from "../../lib/workspace";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import type { CodeMirrorEditorHandle, JumpTarget } from "./CodeMirrorEditor";
import { CommentsPane } from "./CommentsPane";
import type { PendingCommentAnchor } from "./CommentsPane";
import { CompilePane } from "./CompilePane";
import type { CompilePaneHandle } from "./CompilePane";
import { ImagePreviewPane } from "./ImagePreviewPane";
import { ModeSwitcher } from "./ModeSwitcher";
import type { LintFinding } from "./polishingLint";
import { SplitPane } from "./SplitPane";
import { serializeTabular } from "./tableDesigner";
import type { TabularMatch, TableGridModel } from "./tableDesigner";
import { TableDesignerDialog } from "./TableDesignerDialog";
import { PackageDocDialog } from "./PackageDocDialog";
import { AddPackageDialog } from "./AddPackageDialog";
import { MissingFileFixDialog } from "./MissingFileFixDialog";
import { DuplicateLabelFixDialog } from "./DuplicateLabelFixDialog";
import { EscapeAmpersandDialog } from "./EscapeAmpersandDialog";
import { findLabelOccurrences } from "./refCompletion";
import { uploadSingleFile } from "./fileUpload";
import styles from "./EditorTab.module.css";

type SnapshotOut = components["schemas"]["SnapshotOut"];
type CompileRunOut = components["schemas"]["CompileRunOut"];
type CommentOut = components["schemas"]["CommentOut"];

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
  const {
    projectId,
    files,
    selectedFileId,
    selectFile,
    canWrite,
    canEditText,
    refreshFiles,
    currentFileText,
    setCurrentFileText,
    jumpToLineRef,
  } = useWorkspace();
  const { mode } = useEditingMode();
  const { show } = useToast();
  const selectedFile = files.find((f) => f.id === selectedFileId);
  const compilePaneRef = useRef<CompilePaneHandle>(null);
  const codeMirrorRef = useRef<CodeMirrorEditorHandle>(null);
  const jumpTokenRef = useRef(0);
  const [jump, setJump] = useState<{ fileId: string } & JumpTarget | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [showComments, setShowComments] = useState(
    () => localStorage.getItem(`freeleaf.showComments.${projectId}`) === "1",
  );
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [pendingCommentAnchor, setPendingCommentAnchor] = useState<PendingCommentAnchor | null>(null);
  const [focusedComment, setFocusedComment] = useState<{ id: string; token: number } | null>(null);
  const focusCommentTokenRef = useRef(0);

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

  // Points the sidebar's shared jump-to-line slot (Plan.md §9 Phase 11) at
  // this tab's own handler so the Outline/Figures & Tables panels can
  // navigate the editor without being directly wired to it.
  useEffect(() => {
    jumpToLineRef.current = handleJumpToLine;
    return () => {
      jumpToLineRef.current = null;
    };
  }, [jumpToLineRef, handleJumpToLine]);

  // The sidebar's Outline/Figures & Tables tabs only make sense for
  // whichever file is actually open in the editor — clear the shared text
  // when there's nothing (or an image) to scan, and on unmount.
  useEffect(() => {
    if (!selectedFile || selectedFile.type === "image") setCurrentFileText("");
  }, [selectedFile, setCurrentFileText]);
  useEffect(() => () => setCurrentFileText(""), [setCurrentFileText]);

  // Right-click "Add comment" on a text selection (CodeMirrorEditor) opens
  // the Comments pane (if hidden) with that selection queued up so the next
  // top-level comment posted from it anchors to the marked text instead of
  // just the cursor's current line.
  const handleAddCommentFromSelection = useCallback(
    (anchor: PendingCommentAnchor) => {
      setPendingCommentAnchor(anchor);
      setShowComments(true);
      localStorage.setItem(`freeleaf.showComments.${projectId}`, "1");
    },
    [projectId],
  );

  // Clicking a comment's highlighted marked text in the editor scrolls that
  // thread into view in the Comments pane (opening it if hidden) — the
  // token lets clicking the *same* anchor again re-trigger the scroll/flash
  // (same pattern as `jump`'s token above), since re-setting an unchanged
  // id wouldn't otherwise be seen as a change.
  const handleCommentAnchorClick = useCallback(
    (commentId: string) => {
      focusCommentTokenRef.current += 1;
      setFocusedComment({ id: commentId, token: focusCommentTokenRef.current });
      setShowComments(true);
      localStorage.setItem(`freeleaf.showComments.${projectId}`, "1");
    },
    [projectId],
  );

  // Memoized against `comments` specifically (not just inline) — this array
  // otherwise gets a fresh reference on every render, including ones with no
  // actual comment-list change (e.g. every cursor move while typing), which
  // used to force a decoration recompute far more often than intended. See
  // computeCommentAnchorDecorations's own docstring for why that recompute
  // frequency mattered: it used to be the cause of a real "comment highlight
  // resets position" bug even after this fix (now fixed at the source too).
  const commentAnchors = useMemo(
    () =>
      comments
        .filter((c) => c.anchor_from != null && c.anchor_to != null)
        .map((c) => ({ id: c.id, from: c.anchor_from!, to: c.anchor_to!, resolved: c.resolved })),
    [comments],
  );

  // A pending selection anchor belongs to whichever file it was marked on —
  // discard it on file switch so it can't get attached to the wrong file.
  useEffect(() => {
    setPendingCommentAnchor(null);
  }, [selectedFile?.id]);

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

  // Reviewing mode's "safety baseline" (Plan.md §9 Phase 8): a whole-project
  // revert point, independent of per-character suggestion tracking (see
  // suggestions.ts) — picking a snapshot here doesn't affect which
  // suggestions are shown, it's just "what would 'Revert project to
  // baseline' restore to."
  const [snapshots, setSnapshots] = useState<SnapshotOut[]>([]);
  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [trackChangesBusy, setTrackChangesBusy] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);

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

  const handleAcceptAllSuggestions = useCallback(() => {
    if (!window.confirm(`Accept all ${suggestionCount} pending suggestion(s) in this file?`)) return;
    codeMirrorRef.current?.acceptAllSuggestions();
  }, [suggestionCount]);

  const handleRejectAllSuggestions = useCallback(() => {
    if (!window.confirm(`Reject all ${suggestionCount} pending suggestion(s) in this file?`)) return;
    codeMirrorRef.current?.rejectAllSuggestions();
  }, [suggestionCount]);

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

  // Package Docs gutter: opened from a gutter icon on a \usepackage line.
  const [packageDoc, setPackageDoc] = useState<string | null>(null);

  // Fix-it assistant (fixItRules.ts): pattern-matched suggested fixes shown
  // in CompilePane's diagnostics list.
  const [addPackageFix, setAddPackageFix] = useState<{ package: string; commandOrEnv: string } | null>(null);
  const [missingFileFix, setMissingFileFix] = useState<{ filename: string; fatal: boolean } | null>(null);
  const [duplicateLabelFix, setDuplicateLabelFix] = useState<string | null>(null);
  const [ampersandFix, setAmpersandFix] = useState<number | null>(null);
  const [missingFileUploading, setMissingFileUploading] = useState(false);

  const handleConfirmAddPackage = useCallback(() => {
    if (!addPackageFix) return;
    const ok = codeMirrorRef.current?.applyAddPackage(addPackageFix.package);
    setAddPackageFix(null);
    if (ok) {
      show(`Added \\usepackage{${addPackageFix.package}}.`);
      compilePaneRef.current?.triggerCompile();
    }
  }, [addPackageFix, show]);

  const handlePickExistingFile = useCallback(
    (path: string) => {
      if (!missingFileFix) return;
      const ok = codeMirrorRef.current?.applyMissingFileFix(missingFileFix.filename, path);
      setMissingFileFix(null);
      if (ok) {
        show("Reference updated.");
        compilePaneRef.current?.triggerCompile();
      } else {
        show("That reference changed elsewhere — please try again.", "error");
      }
    },
    [missingFileFix, show],
  );

  const handleUploadMissingFile = useCallback(
    async (file: File) => {
      if (!missingFileFix) return;
      setMissingFileUploading(true);
      const renamed = new File([file], missingFileFix.filename, { type: file.type });
      const { error } = await uploadSingleFile(projectId, "", renamed);
      setMissingFileUploading(false);
      if (error) {
        show((error as { detail?: string }).detail ?? "Could not upload that file.", "error");
        return;
      }
      await refreshFiles();
      setMissingFileFix(null);
      show("File uploaded.");
      compilePaneRef.current?.triggerCompile();
    },
    [missingFileFix, projectId, refreshFiles, show],
  );

  const handleRenameLabelOccurrence = useCallback(
    (occurrenceIndex: number, newKey: string) => {
      if (!duplicateLabelFix) return;
      const ok = codeMirrorRef.current?.applyLabelFix(duplicateLabelFix, occurrenceIndex, `\\label{${newKey}}`);
      setDuplicateLabelFix(null);
      if (ok) {
        show("Label renamed.");
        compilePaneRef.current?.triggerCompile();
      } else {
        show("That label changed elsewhere — please try again.", "error");
      }
    },
    [duplicateLabelFix, show],
  );

  const handleDeleteLabelOccurrence = useCallback(
    (occurrenceIndex: number) => {
      if (!duplicateLabelFix) return;
      const ok = codeMirrorRef.current?.applyLabelFix(duplicateLabelFix, occurrenceIndex, "");
      setDuplicateLabelFix(null);
      if (ok) {
        show("Label removed.");
        compilePaneRef.current?.triggerCompile();
      } else {
        show("That label changed elsewhere — please try again.", "error");
      }
    },
    [duplicateLabelFix, show],
  );

  const handleConfirmEscapeAmpersand = useCallback(() => {
    if (ampersandFix == null) return;
    const ok = codeMirrorRef.current?.applyEscapeAmpersand(ampersandFix);
    setAmpersandFix(null);
    if (ok) {
      show("Escaped.");
      compilePaneRef.current?.triggerCompile();
    } else {
      show("That line changed elsewhere — please try again.", "error");
    }
  }, [ampersandFix, show]);

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
    return <ImagePreviewPane file={selectedFile} />;
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
                variant="ghost"
                size="sm"
                onClick={() => codeMirrorRef.current?.openSearch()}
                title="Find/replace in this file (Cmd/Ctrl+F)"
              >
                <Search size={14} aria-hidden="true" />
              </Button>
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
          {suggestionCount > 0 && (
            <div className={styles.trackChangesBar}>
              <span className={styles.trackChangesHint}>
                {suggestionCount} suggestion{suggestionCount === 1 ? "" : "s"} pending in this file
              </span>
              {canWrite && (
                <>
                  <Button variant="secondary" size="sm" onClick={handleAcceptAllSuggestions}>
                    Accept all
                  </Button>
                  <Button variant="danger" size="sm" onClick={handleRejectAllSuggestions}>
                    Reject all
                  </Button>
                </>
              )}
            </div>
          )}
          <div className={styles.paneBody}>
            <CodeMirrorEditor
              ref={codeMirrorRef}
              projectId={projectId}
              fileId={selectedFile.id}
              readOnly={!canEditText}
              onContentChanged={handleContentChanged}
              onCompileShortcut={handleCompileShortcut}
              onJumpToPdf={handleJumpToPdf}
              jumpTarget={jump && jump.fileId === selectedFile.id ? jump : undefined}
              onActivity={canEditText ? handleActivity : undefined}
              onKeystroke={canEditText ? handleKeystroke : undefined}
              onCursorLineChange={setCursorLine}
              suggestMode={mode === "reviewing"}
              canModerateSuggestions={canWrite}
              onSuggestionCountChange={setSuggestionCount}
              polishingEnabled={mode === "polishing"}
              onLintFindings={setLintFindings}
              onOpenTableDesigner={handleOpenTableDesigner}
              onOpenPackageDoc={setPackageDoc}
              commentAnchors={commentAnchors}
              onAddComment={handleAddCommentFromSelection}
              onCommentAnchorClick={handleCommentAnchorClick}
              onDocTextChange={setCurrentFileText}
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
                pendingAnchor={pendingCommentAnchor}
                onClearPendingAnchor={() => setPendingCommentAnchor(null)}
                onCommentsChange={setComments}
                focusedComment={focusedComment}
              />
            }
            right={
              <CompilePane
                ref={compilePaneRef}
                projectId={projectId}
                canWrite={canWrite}
                onJumpToSource={handleJumpToSource}
                onRunChanged={setLatestRun}
                onAddPackage={(pkg, commandOrEnv) => setAddPackageFix({ package: pkg, commandOrEnv })}
                onFixMissingFile={(filename, fatal) => setMissingFileFix({ filename, fatal })}
                onFixDuplicateLabel={setDuplicateLabelFix}
                onFixUnescapedAmpersand={setAmpersandFix}
              />
            }
          />
        ) : (
          <CompilePane
            ref={compilePaneRef}
            projectId={projectId}
            canWrite={canWrite}
            onJumpToSource={handleJumpToSource}
            onAddPackage={(pkg, commandOrEnv) => setAddPackageFix({ package: pkg, commandOrEnv })}
            onFixMissingFile={(filename, fatal) => setMissingFileFix({ filename, fatal })}
            onFixDuplicateLabel={setDuplicateLabelFix}
            onFixUnescapedAmpersand={setAmpersandFix}
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
    {packageDoc && <PackageDocDialog packageName={packageDoc} onClose={() => setPackageDoc(null)} />}
    {addPackageFix && (
      <AddPackageDialog
        packageName={addPackageFix.package}
        commandOrEnv={addPackageFix.commandOrEnv}
        onConfirm={handleConfirmAddPackage}
        onCancel={() => setAddPackageFix(null)}
      />
    )}
    {missingFileFix && (
      <MissingFileFixDialog
        filename={missingFileFix.filename}
        fatal={missingFileFix.fatal}
        files={files}
        uploading={missingFileUploading}
        onPickExisting={handlePickExistingFile}
        onUpload={handleUploadMissingFile}
        onCancel={() => setMissingFileFix(null)}
      />
    )}
    {duplicateLabelFix && (
      <DuplicateLabelFixDialog
        label={duplicateLabelFix}
        occurrences={findLabelOccurrences(currentFileText, duplicateLabelFix)}
        onRename={handleRenameLabelOccurrence}
        onDelete={handleDeleteLabelOccurrence}
        onCancel={() => setDuplicateLabelFix(null)}
      />
    )}
    {ampersandFix != null && (
      <EscapeAmpersandDialog
        line={ampersandFix}
        onConfirm={handleConfirmEscapeAmpersand}
        onCancel={() => setAmpersandFix(null)}
      />
    )}
    </>
  );
}

