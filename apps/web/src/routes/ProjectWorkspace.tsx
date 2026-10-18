import { apiOrigin } from "@freeleaf/shared";
import { ArrowLeft, Download, Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";

import { EditorTab } from "../components/workspace/EditorTab";
import { HistoryTab } from "../components/workspace/HistoryTab";
import { LibraryTab } from "../components/workspace/LibraryTab";
import { SettingsTab } from "../components/workspace/SettingsTab";
import { ShareButton } from "../components/workspace/ShareButton";
import { WorkspaceSidebar } from "../components/workspace/WorkspaceSidebar";
import { PageSpinner } from "../components/ui/Spinner";
import { BibliographyProvider } from "../lib/bibliography";
import { EditingModeProvider } from "../lib/editingMode";
import { useIsMobile } from "../lib/useMediaQuery";
import { WorkspaceProvider, useWorkspace } from "../lib/workspace";
import styles from "./ProjectWorkspace.module.css";

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return <Navigate to="/projects" replace />;
  return (
    <WorkspaceProvider projectId={projectId}>
      <BibliographyProvider projectId={projectId}>
        <WorkspaceShell />
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
    <EditingModeProvider projectId={projectId} role={project.role}>
      <WorkspaceShellBody base={base} projectId={projectId} project={project} />
    </EditingModeProvider>
  );
}

function WorkspaceShellBody({
  base,
  projectId,
  project,
}: {
  base: string;
  projectId: string;
  project: NonNullable<ReturnType<typeof useWorkspace>["project"]>;
}) {
  const isMobile = useIsMobile();
  // The Files/Outline/Figures sidebar is a fixed 240px column on desktop —
  // more than half a phone's width, and not something that can usefully
  // sit alongside the editor's own mobile tab bar (EditorTab.tsx). Below
  // the breakpoint it becomes a slide-over drawer instead, closed by
  // default so a fresh mobile visit lands straight on the editor content,
  // matching the "PDF first" default EditorTab itself uses.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        {isMobile && (
          <button
            type="button"
            className={styles.backLink}
            onClick={() => setSidebarOpen(true)}
            title="Files, outline, figures & tables"
          >
            <Menu size={16} aria-hidden="true" />
          </button>
        )}
        <NavLink to="/projects" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
        </NavLink>
        <h1 className={styles.projectName}>{project.name}</h1>
        {/* Library/Settings/History/Export/Share move into the hamburger
            drawer on mobile (below) — the four nav tabs alone already take
            ~280px, more than a phone's full width; there's no shrinking
            that leaves room for them plus Export/Share inline. */}
        {!isMobile && (
          <>
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
          </>
        )}
      </header>

      <div className={styles.body}>
        {isMobile ? (
          <>
            {sidebarOpen && (
              <>
                <div className={styles.sidebarBackdrop} onClick={() => setSidebarOpen(false)} />
                <aside className={styles.sidebarDrawer}>
                  <button
                    type="button"
                    className={styles.sidebarDrawerClose}
                    onClick={() => setSidebarOpen(false)}
                    title="Close"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                  <nav className={styles.drawerNav}>
                    <NavLink to={`${base}/editor`} className={({ isActive }) => tabClass(isActive)} onClick={() => setSidebarOpen(false)}>
                      Editor
                    </NavLink>
                    <NavLink to={`${base}/library`} className={({ isActive }) => tabClass(isActive)} onClick={() => setSidebarOpen(false)}>
                      Library
                    </NavLink>
                    <NavLink to={`${base}/settings`} className={({ isActive }) => tabClass(isActive)} onClick={() => setSidebarOpen(false)}>
                      Settings
                    </NavLink>
                    <NavLink to={`${base}/history`} className={({ isActive }) => tabClass(isActive)} onClick={() => setSidebarOpen(false)}>
                      History
                    </NavLink>
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
                  </nav>
                  <div className={styles.drawerDivider} />
                  <WorkspaceSidebar />
                </aside>
              </>
            )}
          </>
        ) : (
          <aside className={styles.sidebar}>
            <WorkspaceSidebar />
          </aside>
        )}
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
