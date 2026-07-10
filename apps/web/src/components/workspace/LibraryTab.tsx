import { BookOpen } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";

export function LibraryTab() {
  return (
    <EmptyState
      icon={<BookOpen size={32} aria-hidden="true" />}
      title="Library coming soon"
      description="BibTeX entry management, \cite{} autocomplete, and paste/drop detection arrive in Phase 6."
    />
  );
}
