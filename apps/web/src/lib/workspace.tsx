import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ProjectOut = components["schemas"]["ProjectOut"];
export type ProjectFileOut = components["schemas"]["ProjectFileOut"];

interface WorkspaceContextValue {
  projectId: string;
  project: ProjectOut | null;
  files: ProjectFileOut[];
  loading: boolean;
  refreshFiles: () => Promise<void>;
  selectedFileId: string | null;
  selectFile: (fileId: string | null) => void;
  canWrite: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [project, setProject] = useState<ProjectOut | null>(null);
  const [files, setFiles] = useState<ProjectFileOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const refreshFiles = useCallback(async () => {
    const { data } = await api.GET("/api/projects/{project_id}/files", {
      params: { path: { project_id: projectId } },
    });
    setFiles(data ?? []);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [projectRes] = await Promise.all([
        api.GET("/api/projects/{project_id}", { params: { path: { project_id: projectId } } }),
        refreshFiles(),
      ]);
      if (cancelled) return;
      setProject(projectRes.data ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshFiles]);

  useEffect(() => {
    if (selectedFileId || files.length === 0) return;
    const mainTex = files.find((f) => f.path === "main.tex") ?? files.find((f) => f.type !== "folder");
    if (mainTex) setSelectedFileId(mainTex.id);
  }, [files, selectedFileId]);

  const canWrite = project?.role === "owner" || project?.role === "editor";

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      projectId,
      project,
      files,
      loading,
      refreshFiles,
      selectedFileId,
      selectFile: setSelectedFileId,
      canWrite,
    }),
    [projectId, project, files, loading, refreshFiles, selectedFileId, canWrite],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
