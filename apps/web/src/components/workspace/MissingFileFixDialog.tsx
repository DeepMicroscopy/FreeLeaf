import { useEffect, useRef } from "react";
import type { ChangeEvent } from "react";

import { Button } from "../ui/Button";
import type { ProjectFileOut } from "../../lib/workspace";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./FixItDialogs.module.css";

export function MissingFileFixDialog({
  filename,
  fatal,
  files,
  uploading,
  onPickExisting,
  onUpload,
  onCancel,
}: {
  filename: string;
  fatal: boolean;
  files: ProjectFileOut[];
  uploading: boolean;
  onPickExisting: (path: string) => void;
  onUpload: (file: File) => void;
  onCancel: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  const candidates = files.filter((f) => f.type !== "folder" && f.path !== filename);

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    onUpload(file);
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={`File not found: ${filename}`}>
        <div className={styles.header}>
          <PenguinMascot pose="magnifier" />
          <div>
            <h3 className={styles.title}>File not found: {filename}</h3>
            <p className={styles.hint}>{fatal ? "This is blocking the compile entirely." : "The compile continues without it, using a placeholder."}</p>
          </div>
        </div>

        <div className={styles.body}>
          {fatal && (
            <p className={styles.banner}>No PDF can be produced until this is fixed.</p>
          )}

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Use an existing file instead</span>
            {candidates.length === 0 ? (
              <p className={styles.description}>No other files in this project yet.</p>
            ) : (
              <div className={styles.list}>
                {candidates.map((f) => (
                  <div key={f.id} className={styles.listItem}>
                    <span className={styles.listItemMain}>{f.path}</span>
                    <Button variant="secondary" size="sm" onClick={() => onPickExisting(f.path)}>
                      Use this
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Or upload a new file named {filename}</span>
            <input ref={fileInputRef} type="file" className="visually-hidden" onChange={handleFileInputChange} />
            <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
              Choose file to upload
            </Button>
          </div>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
