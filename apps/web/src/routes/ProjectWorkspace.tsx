import { apiOrigin } from "@freeleaf/shared";
import { ArrowLeft, Download } from "lucide-react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";

import { EditorTab } from "../components/workspace/EditorTab";
import { FileTree } from "../components/workspace/FileTree";
import { HistoryTab } from "../components/workspace/HistoryTab";
import { LibraryTab } from "../components/workspace/LibraryTab";
import { SettingsTab } from "../components/workspace/SettingsTab";
import { ShareButton } from "../components/workspace/ShareButton";
import { PageSpinner } from "../components/ui/Spinner";
import { BibliographyProvider } from "../lib/bibliography";
import { EditingModeProvider } from "../lib/editingMode";
import { WorkspaceProvider, useWorkspace } from "../lib/workspace";
import styles from "./ProjectWorkspace.module.css";

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/projects" replace />;
  return (
    <WorkspaceProvider projectId={projectId}>
      <BibliographyProvider projectId={projectId}>
        <EditingModeProvider projectId={projectId}>
          <WorkspaceShell />
        </EditingModeProvider>
      </BibliographyProvider>
    </WorkspaceProvider>
  );
}

function WorkspaceShell() {
  const { projectId, project, loading } = useWorkspace();

  if (loading) return <PageSpinner />;
  if (!project) return <Navigate to="/projects" replace />;

  const base = `/projects/${projectId}`;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <NavLink to="/projects" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
        </NavLink>
        <h1 className={styles.projectName}>{project.name}</h1>
        <nav className={styles.tabs}>
          <NavLink to={`${base}/editor`} className={({ isActive }) => tabClass(isActive)}>
            Editor
          </NavLink>
          <NavLink to={`${base}/library`} className={({ isActive }) => tabClass(isActive)}>
            Library
          </NavLink>
          <NavLink to={`${base}/settings`} className={({ isActive }) => tabClass(isActive)}>
            Settings
          </NavLink>
          <NavLink to={`${base}/history`} className={({ isActive }) => tabClass(isActive)}>
            History
          </NavLink>
        </nav>
        <div className={styles.headerActions}>
          <a
            className={styles.exportLink}
            href={`${apiOrigin()}/api/projects/${projectId}/export`}
            download
            title="Download this project as a .zip"
          >
            <Download size={14} aria-hidden="true" />
            Export
          </a>
          {project.role === "owner" && <ShareButton projectId={projectId} />}
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <FileTree />
        </aside>
        <main className={styles.main}>
          <Routes>
            <Route index element={<Navigate to="editor" replace />} />
            <Route path="editor" element={<EditorTab />} />
            <Route path="library" element={<LibraryTab />} />
            <Route path="settings" element={<SettingsTab />} />
            <Route path="history" element={<HistoryTab />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function tabClass(isActive: boolean): string {
  return [styles.tab, isActive ? styles.tabActive : ""].join(" ");
}
