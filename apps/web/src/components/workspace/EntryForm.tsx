import type { BibEntry } from "@freeleaf/shared";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import styles from "./EntryForm.module.css";

const ENTRY_TYPES = ["article", "book", "inproceedings", "incollection", "phdthesis", "techreport", "misc"];

export function EntryForm({
  initial,
  existingKeys,
  onSubmit,
  onCancel,
}: {
  initial: BibEntry | null;
  existingKeys: string[];
  onSubmit: (entry: { type: string; key: string; fields: Record<string, string> }) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? "article");
  const [key, setKey] = useState(initial?.key ?? "");
  const [title, setTitle] = useState(initial?.fields.title ?? "");
  const [author, setAuthor] = useState(initial?.fields.author ?? "");
  const [year, setYear] = useState(initial?.fields.year ?? "");
  const [journal, setJournal] = useState(initial?.fields.journal ?? initial?.fields.booktitle ?? "");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError("Cite key is required.");
      return;
    }
    if (trimmedKey !== initial?.key && existingKeys.includes(trimmedKey)) {
      setError(`Key "${trimmedKey}" is already used by another reference.`);
      return;
    }
    const fields: Record<string, string> = {};
    if (title.trim()) fields.title = title.trim();
    if (author.trim()) fields.author = author.trim();
    if (year.trim()) fields.year = year.trim();
    if (journal.trim()) fields[type === "book" ? "publisher" : "journal"] = journal.trim();
    onSubmit({ type, key: trimmedKey, fields });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <label className={styles.selectField}>
          <span className={styles.label}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={styles.select}>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Cite key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="smith2024"
          className={styles.keyField}
        />
      </div>
      <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className={styles.row}>
        <TextField label="Author" value={author} onChange={(e) => setAuthor(e.target.value)} />
        <TextField
          label="Year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className={styles.yearField}
        />
      </div>
      <TextField
        label={type === "book" ? "Publisher" : "Journal / booktitle"}
        value={journal}
        onChange={(e) => setJournal(e.target.value)}
      />
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{initial ? "Save changes" : "Add reference"}</Button>
      </div>
    </form>
  );
}
