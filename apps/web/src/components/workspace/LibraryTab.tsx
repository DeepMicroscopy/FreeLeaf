import { looksLikeBibtex, parseBibtex } from "@freeleaf/shared";
import type { BibEntry } from "@freeleaf/shared";
import { BookOpen, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";

import { useBibDoc, useBibliography } from "../../lib/bibliography";
import { useWorkspace } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import type { DuplicateChoice } from "./DuplicateDialog";
import { DuplicateDialog } from "./DuplicateDialog";
import { EntryForm } from "./EntryForm";
import styles from "./LibraryTab.module.css";

export function LibraryTab() {
  const central = useBibliography();
  const { addEntries, findNearDuplicate, findByKey } = central;
  const { canWrite, projectId, files } = useWorkspace();
  const { show } = useToast();
  const [formEntry, setFormEntry] = useState<BibEntry | "new" | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const bibFiles = files.filter((f) => f.type === "bib");
  const centralFile = bibFiles.find((f) => f.id === central.centralFileId) ?? null;
  const [viewFileId, setViewFileId] = useState<string | null>(null);
  const isCentral = viewFileId === null || viewFileId === central.centralFileId;
  const otherDoc = useBibDoc(projectId, isCentral ? null : viewFileId);
  const { entries, loading, updateEntry, deleteEntry } = isCentral ? central : otherDoc;
  const [dupModal, setDupModal] = useState<{
    existing: BibEntry;
    incoming: { key: string; fields: Record<string, string> };
    resolve: (choice: DuplicateChoice) => void;
  } | null>(null);

  function showDuplicateModal(
    existing: BibEntry,
    incoming: { key: string; fields: Record<string, string> },
  ): Promise<DuplicateChoice> {
    return new Promise((resolve) => {
      setDupModal({
        existing,
        incoming,
        resolve: (choice) => {
          setDupModal(null);
          resolve(choice);
        },
      });
    });
  }

  async function importParsed(parsed: Array<{ type: string; key: string; fields: Record<string, string> }>) {
    if (parsed.length === 0) {
      show("No BibTeX entries found in that content.", "error");
      return;
    }
    const addedKeys: string[] = [];
    const alreadyKnownKeys: string[] = [];
    for (const entry of parsed) {
      // Exact key already present -> unambiguous, no modal needed. Must
      // come before the content-based check: an exact re-import otherwise
      // matches itself as a "near duplicate."
      if (findByKey(entry.key)) {
        alreadyKnownKeys.push(entry.key);
        continue;
      }
      const near = findNearDuplicate(entry);
      if (near) {
        const choice = await showDuplicateModal(near, entry);
        if (choice === "skip") continue;
        if (choice === "existing") {
          alreadyKnownKeys.push(near.key);
          continue;
        }
      }
      const { added, conflicts } = addEntries([entry]);
      if (added.length > 0) addedKeys.push(added[0]);
      else if (conflicts.length > 0) alreadyKnownKeys.push(entry.key); // race: key taken between our check and now
    }
    if (addedKeys.length > 0) {
      const alreadyHadSuffix = alreadyKnownKeys.length > 0 ? `, already had: ${alreadyKnownKeys.join(", ")}` : "";
      const centralSuffix = isCentral ? "" : ` (added to ${centralFile?.path ?? "the central library"}, not the file you're viewing)`;
      show(`Added reference${addedKeys.length === 1 ? "" : "s"}: ${addedKeys.join(", ")}${alreadyHadSuffix}.${centralSuffix}`);
    } else if (alreadyKnownKeys.length > 0) {
      show(`Already in the library: ${alreadyKnownKeys.join(", ")} — nothing added.`, "error");
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!canWrite) return;
    const text = e.clipboardData.getData("text/plain");
    if (!looksLikeBibtex(text)) return;
    e.preventDefault();
    void importParsed(parseBibtex(text));
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
    await importParsed(parseBibtex(text));
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
        <div className={styles.toolbarLeft}>
          {bibFiles.length > 1 && (
            <select
              className={styles.fileSelect}
              value={viewFileId ?? central.centralFileId ?? ""}
              onChange={(e) => setViewFileId(e.target.value)}
              aria-label="Bib file to view"
            >
              {bibFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                  {f.id === central.centralFileId ? " (central)" : ""}
                </option>
              ))}
            </select>
          )}
          <span className={styles.hint}>
            <Upload size={13} aria-hidden="true" /> Paste or drop a .bib file anywhere here to import it
          </span>
        </div>
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
          existingKeys={(formEntry === "new" ? central.entries : entries).map((e) => e.key)}
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
      {dupModal && (
        <DuplicateDialog existing={dupModal.existing} incoming={dupModal.incoming} onResolve={dupModal.resolve} />
      )}
    </div>
  );
}
