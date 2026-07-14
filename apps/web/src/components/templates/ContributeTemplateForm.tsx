import { api } from "@freeleaf/shared";
import { useState } from "react";
import type { FormEvent } from "react";

import { useSiteInfo } from "../../lib/siteInfo";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { useToast } from "../ui/Toast";
import styles from "./ContributeTemplateForm.module.css";

export function ContributeTemplateForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { show } = useToast();
  const { templateContributionMode } = useSiteInfo();
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sourceUrl.trim() || !zipFile) return;
    setSubmitting(true);
    const { data, error } = await api.POST("/api/templates", {
      params: {
        query: {
          name: name.trim(),
          source_url: sourceUrl.trim(),
          description: description.trim(),
          category: category.trim(),
        },
      },
      // Cast as any here to satisfy the strict OpenAPI schema type checker
      body: { file: zipFile as any, thumbnail: thumbnail as any },
      bodySerializer: (body) => {
        const form = new FormData();
        form.append("file", body.file);
        if (body.thumbnail) form.append("thumbnail", body.thumbnail);
        return form;
      },
    });
    setSubmitting(false);
    if (error || !data) {
      show((error as { detail?: string })?.detail ?? "Could not submit that template.", "error");
      return;
    }
    show(
      data.is_published
        ? "Template published to the gallery."
        : "Template submitted — an admin will review it before it appears in the gallery.",
    );
    onDone();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {templateContributionMode === "review_required" && (
        <p className={styles.notice}>Submitted templates are held for admin review before appearing in the gallery.</p>
      )}
      <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      <TextField
        label="Source URL"
        hint="Where this template comes from — required, for attribution."
        type="url"
        placeholder="https://example.com/..."
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        required
      />
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <TextField
        label="Category"
        hint='Optional — e.g. "conference", "thesis"'
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <label className={styles.fileField}>
        <span>Template .zip</span>
        <input type="file" accept=".zip" onChange={(e) => setZipFile(e.target.files?.[0] ?? null)} required />
      </label>
      <label className={styles.fileField}>
        <span>Thumbnail image (optional)</span>
        <input type="file" accept="image/*" onChange={(e) => setThumbnail(e.target.files?.[0] ?? null)} />
      </label>
      <div className={styles.actions}>
        <Button type="submit" loading={submitting} disabled={!name.trim() || !sourceUrl.trim() || !zipFile}>
          Submit
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
