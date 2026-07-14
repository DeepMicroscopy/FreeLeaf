import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { ExternalLink, FileText, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import styles from "./TemplateGallery.module.css";

type TemplateOut = components["schemas"]["TemplateOut"];

export function TemplateGallery({ onCreated, onCancel }: { onCreated: (projectId: string) => void; onCancel: () => void }) {
  const { show } = useToast();
  const [templates, setTemplates] = useState<TemplateOut[] | null>(null);
  const [selected, setSelected] = useState<TemplateOut | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.GET("/api/templates").then(({ data }) => setTemplates(data ?? []));
  }, []);

  function selectTemplate(t: TemplateOut) {
    setSelected(t);
    setName(t.name);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!selected || !name.trim()) return;
    setCreating(true);
    const { data, error } = await api.POST("/api/projects/from-template/{template_id}", {
      params: { path: { template_id: selected.id } },
      body: { name: name.trim() },
    });
    setCreating(false);
    if (data) onCreated(data.id);
    else show((error as { detail?: string })?.detail ?? "Could not create a project from that template.", "error");
  }

  if (selected) {
    return (
      <form className={styles.nameForm} onSubmit={handleCreate}>
        <TextField
          label="Project name"
          hint={`Starting from "${selected.name}"`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <div className={styles.nameFormActions}>
          <Button type="submit" loading={creating}>
            Create
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSelected(null)} disabled={creating}>
            Back
          </Button>
        </div>
      </form>
    );
  }

  if (templates === null) return <PageSpinner />;

  return (
    <div>
      {templates.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid size={28} aria-hidden="true" />}
          title="No templates yet"
          description="Nobody's added a template to the gallery yet."
        />
      ) : (
        <ul className={styles.grid}>
          {templates.map((t) => (
            <li key={t.id}>
              <button type="button" className={styles.card} onClick={() => selectTemplate(t)}>
                <div className={styles.icon}>
                  <FileText size={18} aria-hidden="true" />
                </div>
                <div className={styles.body}>
                  <p className={styles.name}>{t.name}</p>
                  {t.category && <span className={styles.category}>{t.category}</span>}
                  {t.description && <p className={styles.description}>{t.description}</p>}
                  <span className={styles.source}>
                    <ExternalLink size={11} aria-hidden="true" />
                    {t.source_url}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Back
      </Button>
    </div>
  );
}
