import { useCallback, useState } from "react";

export type ProjectsViewMode = "grid" | "list";
export type ProjectsSortKey = "name" | "owner" | "updated_at";
export type ProjectsSortDir = "asc" | "desc";

interface ProjectsView {
  mode: ProjectsViewMode;
  sortKey: ProjectsSortKey;
  sortDir: ProjectsSortDir;
}

const STORAGE_KEY = "freeleaf.projectsView";

const DEFAULTS: ProjectsView = { mode: "grid", sortKey: "updated_at", sortDir: "desc" };

function readStored(): ProjectsView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode === "list" ? "list" : "grid",
      sortKey: ["name", "owner", "updated_at"].includes(parsed.sortKey) ? parsed.sortKey : DEFAULTS.sortKey,
      sortDir: parsed.sortDir === "asc" ? "asc" : "desc",
    };
  } catch {
    return DEFAULTS;
  }
}

// One-page-only preference (grid vs list, sort column/direction on the
// projects dashboard) — a plain hook with localStorage, not a context, since
// only ProjectsPage itself ever reads it.
export function useProjectsView() {
  const [view, setView] = useState<ProjectsView>(readStored);

  const persist = useCallback((next: ProjectsView) => {
    setView(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const setMode = useCallback((mode: ProjectsViewMode) => persist({ ...view, mode }), [view, persist]);

  const toggleSort = useCallback(
    (sortKey: ProjectsSortKey) => {
      if (view.sortKey === sortKey) {
        persist({ ...view, sortDir: view.sortDir === "asc" ? "desc" : "asc" });
      } else {
        persist({ ...view, sortKey, sortDir: sortKey === "updated_at" ? "desc" : "asc" });
      }
    },
    [view, persist],
  );

  return { ...view, setMode, toggleSort };
}
