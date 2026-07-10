import { Settings2 } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";

export function SettingsTab() {
  return (
    <EmptyState
      icon={<Settings2 size={32} aria-hidden="true" />}
      title="Settings coming soon"
      description="Choosing the central .bib file and the PDF compiler (pdflatex / xelatex) arrives in Phase 7."
    />
  );
}
