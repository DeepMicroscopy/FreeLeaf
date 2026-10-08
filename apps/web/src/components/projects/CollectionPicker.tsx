import type { components } from "@freeleaf/shared";
import { useState } from "react";
import { Check, Folder, FolderOpen, Plus } from "lucide-react";

import styles from "./CollectionPicker.module.css";

type ProjectCollectionOut = components["schemas"]["ProjectCollectionOut"];

export function CollectionPicker({
  currentCollectionId,
  collections,
  onAssign,
  onCreateNew,
}: {
  currentCollectionId: string | null | undefined;
  collections: ProjectCollectionOut[];
  onAssign: (collectionId: string | null) => void;
  onCreateNew: (name: string) => Promise<ProjectCollectionOut | null>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function close() {
    setOpen(false);
    setCreating(false);
    setNewName("");
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const created = await onCreateNew(name);
    if (created) {
      onAssign(created.id);
      close();
    }
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.trigger}
        aria-label="Assign to collection"
        title="Assign to collection"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {currentCollectionId ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
      </button>
      {open && (
        <>
          <button className={styles.backdrop} aria-label="Close" onClick={(e) => { e.stopPropagation(); close(); }} />
          <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.option}
              onClick={() => {
                onAssign(null);
                close();
              }}
            >
              <span>Uncategorized</span>
              {!currentCollectionId && <Check size={14} aria-hidden="true" />}
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.option}
                onClick={() => {
                  onAssign(c.id);
                  close();
                }}
              >
                <span>{c.name}</span>
                {currentCollectionId === c.id && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
            <div className={styles.divider} />
            {creating ? (
              <form className={styles.newForm} onSubmit={submitNew}>
                <input
                  autoFocus
                  className={styles.newInput}
                  placeholder="Collection name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setCreating(false);
                      setNewName("");
                    }
                  }}
                  onBlur={() => {
                    if (!newName.trim()) setCreating(false);
                  }}
                />
              </form>
            ) : (
              <button type="button" className={styles.newTrigger} onClick={() => setCreating(true)}>
                <Plus size={14} aria-hidden="true" />
                New collection
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
