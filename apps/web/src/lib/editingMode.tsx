import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

export type EditingMode = "writing" | "reviewing" | "polishing";

interface EditingModeContextValue {
  mode: EditingMode;
  setMode: (mode: EditingMode) => void;
}

const EditingModeContext = createContext<EditingModeContextValue | null>(null);

function storageKey(projectId: string): string {
  return `freeleaf.editingMode.${projectId}`;
}

function readStoredMode(projectId: string): EditingMode {
  const raw = localStorage.getItem(storageKey(projectId));
  return raw === "reviewing" || raw === "polishing" ? raw : "writing";
}

// Per-user, per-project UI preference (not project state) — each
// collaborator can be in a different mode at once, so this deliberately
// isn't synced via Yjs/ProjectSettings, just persisted locally.
export function EditingModeProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [mode, setModeState] = useState<EditingMode>(() => readStoredMode(projectId));

  const setMode = useCallback(
    (next: EditingMode) => {
      setModeState(next);
      localStorage.setItem(storageKey(projectId), next);
    },
    [projectId],
  );

  return <EditingModeContext.Provider value={{ mode, setMode }}>{children}</EditingModeContext.Provider>;
}

export function useEditingMode(): EditingModeContextValue {
  const ctx = useContext(EditingModeContext);
  if (!ctx) throw new Error("useEditingMode must be used within EditingModeProvider");
  return ctx;
}
