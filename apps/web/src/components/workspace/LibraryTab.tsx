import { looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { BookOpen, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";

import { useBibliography } from "../../lib/bibliography";
import { useWorkspace } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { EntryForm } from "./EntryForm";
import styles from "./LibraryTab.module.css";

export function LibraryTab() {
  const { entries, loading, addEntries, updateEntry, deleteEntry } = useBibliography();
  const { canWrite } = useWorkspace();
  const { show } = useToast();
  const [formEntry, setFormEntry] = useState<BibEntry | "new" | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function importParsed(parsed: Array<{ type: string; key: string; fields: Record<string, string> }>) {
    if (parsed.length === 0) {
      show("No BibTeX entries found in that content.", "error");
      return;
    }
    const { added, conflicts } = addEntries(parsed);
    if (added.length > 0) {
      const suffix = conflicts.length > 0 ? `, ${conflicts.length} duplicate key(s) skipped` : "";
      show(`Added ${added.length} reference${added.length === 1 ? "" : "s"}${suffix}.`);
    } else if (conflicts.length > 0) {
      show(`All ${conflicts.length} entries were already in the library — nothing added.`, "error");
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!canWrite) return;
    const text = e.clipboardData.getData("text/plain");
    if (!looksLikeBibtex(text)) return;
    e.preventDefault();
    importParsed(parseBibtex(text));
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (!canWrite) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const text = await file.text();
    if (!looksLikeBibtex(text)) {
      show("That file doesn't look like BibTeX.", "error");
      return;
    }
    importParsed(parseBibtex(text));
  }

  function handleDelete(entry: BibEntry) {
    if (!window.confirm(`Delete reference "${entry.key}"? This can't be undone.`)) return;
    deleteEntry(entry.key);
  }

  if (loading) return <PageSpinner />;

  return (
    <div
      className={[styles.root, dragOver ? styles.dragOver : ""].join(" ")}
      data-testid="library-root"
      onPaste={handlePaste}
      onDragOver={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className={styles.toolbar}>
        <span className={styles.hint}>
          <Upload size={13} aria-hidden="true" /> Paste or drop a .bib file anywhere here to import it
        </span>
        {canWrite && (
          <Button size="sm" onClick={() => setFormEntry("new")}>
            <Plus size={14} aria-hidden="true" />
            Add reference
          </Button>
        )}
      </div>

      {formEntry && (
        <EntryForm
          initial={formEntry === "new" ? null : formEntry}
          existingKeys={entries.map((e) => e.key)}
          onCancel={() => setFormEntry(null)}
          onSubmit={(next) => {
            if (formEntry === "new") {
              const { conflicts } = addEntries([next]);
              if (conflicts.length > 0) {
                show(`Key "${next.key}" is already used by another reference.`, "error");
                return;
              }
            } else {
              updateEntry(formEntry.key, next);
            }
            setFormEntry(null);
          }}
        />
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} aria-hidden="true" />}
          title="No references yet"
          description="Add one, or paste/drop BibTeX content anywhere in this tab to import it."
        />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Key</th>
              <th>Type</th>
              <th>Title</th>
              <th>Author</th>
              <th>Year</th>
              {canWrite && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.key}>
                <td className={styles.mono}>{entry.key}</td>
                <td>{entry.type}</td>
                <td>{entry.fields.title ?? "—"}</td>
                <td>{entry.fields.author ?? "—"}</td>
                <td>{entry.fields.year ?? "—"}</td>
                {canWrite && (
                  <td className={styles.actions}>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => setFormEntry(entry)}
                      aria-label={`Edit ${entry.key}`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      onClick={() => handleDelete(entry)}
                      aria-label={`Delete ${entry.key}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
