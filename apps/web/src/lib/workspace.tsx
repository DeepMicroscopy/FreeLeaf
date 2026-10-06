import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";

export type ProjectOut = components["schemas"]["ProjectOut"];
export type ProjectFileOut = components["schemas"]["ProjectFileOut"];

interface WorkspaceContextValue {
  projectId: string;
  project: ProjectOut | null;
  files: ProjectFileOut[];
  loading: boolean;
  refreshFiles: () => Promise<void>;
  /** Re-fetches the project itself (name, role) — call after renaming it. */
  refreshProject: () => Promise<void>;
  selectedFileId: string | null;
  selectFile: (fileId: string | null) => void;
  canWrite: boolean;
  /** True for owner/editor/reviewer — anyone who can type in the document at
   * all. Narrower than `canWrite`: a reviewer can edit text (always as a
   * tracked suggestion, see editingMode.tsx/suggestions.ts) but can't touch
   * file management, settings, or members — those stay gated on `canWrite`. */
  canEditText: boolean;
  /** Live text of whichever `.tex` file is currently open in the editor
   * (Plan.md §9 Phase 11) — kept in sync by `EditorTab`/`CodeMirrorEditor`
   * so the sidebar's Outline/Figures & Tables tabs can scan it without
   * reaching into the editor's own Yjs document. Empty when no file (or a
   * non-`.tex` file) is open. */
  currentFileText: string;
  setCurrentFileText: (text: string) => void;
  /** A mutable slot `EditorTab` points at its own jump-to-line function so
   * the sidebar can call it without the two being directly wired together —
   * `null` when no editor is mounted to jump within. */
  jumpToLineRef: MutableRefObject<((line: number) => void) | null>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [project, setProject] = useState<ProjectOut | null>(null);
  const [files, setFiles] = useState<ProjectFileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [currentFileText, setCurrentFileText] = useState("");
  // Only used to pick which file opens by default (below) — not exposed via
  // context, since nothing else needs it (SettingsTab/CodeMirrorEditor each
  // fetch settings themselves for their own purposes already).
  const [mainDocPath, setMainDocPath] = useState<string | null>(null);
  const jumpToLineRef = useRef<((line: number) => void) | null>(null);

  const refreshFiles = useCallback(async () => {
    const { data } = await api.GET("/api/projects/{project_id}/files", {
      params: { path: { project_id: projectId } },
    });
    setFiles(data ?? []);
  }, [projectId]);

  const refreshProject = useCallback(async () => {
    const { data } = await api.GET("/api/projects/{project_id}", { params: { path: { project_id: projectId } } });
    setProject(data ?? null);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [projectRes, settingsRes] = await Promise.all([
        api.GET("/api/projects/{project_id}", { params: { path: { project_id: projectId } } }),
        api.GET("/api/projects/{project_id}/settings", { params: { path: { project_id: projectId } } }),
        refreshFiles(),
      ]);
      if (cancelled) return;
      setProject(projectRes.data ?? null);
      setMainDocPath(settingsRes.data?.main_doc_path ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshFiles]);

  useEffect(() => {
    // Also gated on `loading`: `files` and `mainDocPath` come from separate
    // concurrent fetches in the effect above, so `files` can land a render
    // before `mainDocPath` does — without this, that in-between render would
    // lock in a fallback file before the real setting ever arrives (this
    // effect never re-picks once `selectedFileId` is set). `loading` only
    // flips false after *both* have resolved.
    if (loading || selectedFileId || files.length === 0) return;
    const texFiles = files.filter((f) => f.type === "tex");
    // Prefer the project's actual configured main document — falling
    // straight to "whatever's first in the list" when that path doesn't
    // literally match a file (e.g. a template/zip import whose real main
    // file isn't named "main.tex", while the setting defaults to it) is
    // what made this pick what looked like an arbitrary file. A project
    // with only one .tex file is unambiguous regardless of the setting.
    const mainDoc =
      files.find((f) => f.path === mainDocPath) ??
      (texFiles.length === 1 ? texFiles[0] : undefined) ??
      files.find((f) => f.path === "main.tex") ??
      files.find((f) => f.type !== "folder");
    if (mainDoc) setSelectedFileId(mainDoc.id);
  }, [files, selectedFileId, mainDocPath, loading]);

  const canWrite = project?.role === "owner" || project?.role === "editor";
  const canEditText = canWrite || project?.role === "reviewer";

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      projectId,
      project,
      files,
      loading,
      refreshFiles,
      refreshProject,
      selectedFileId,
      selectFile: setSelectedFileId,
      canWrite,
      canEditText,
      currentFileText,
      setCurrentFileText,
      jumpToLineRef,
    }),
    [
      projectId,
      project,
      files,
      loading,
      refreshFiles,
      refreshProject,
      selectedFileId,
      canWrite,
      canEditText,
      currentFileText,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
