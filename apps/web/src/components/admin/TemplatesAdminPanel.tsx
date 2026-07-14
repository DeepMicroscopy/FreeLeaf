import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { LayoutGrid } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import styles from "./TemplatesAdminPanel.module.css";

type TemplateOut = components["schemas"]["TemplateOut"];

export function TemplatesAdminPanel() {
  const { show } = useToast();
  const [templates, setTemplates] = useState<TemplateOut[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/templates/all");
    setTemplates(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(t: TemplateOut) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditDescription(t.description);
    setEditSourceUrl(t.source_url);
    setEditCategory(t.category);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    const { data, error } = await api.PATCH("/api/templates/{template_id}", {
      params: { path: { template_id: id } },
      body: {
        name: editName.trim(),
        description: editDescription.trim(),
        source_url: editSourceUrl.trim(),
        category: editCategory.trim(),
      },
    });
    setBusyId(null);
    if (error || !data) {
      show((error as { detail?: string })?.detail ?? "Couldn't save that template.", "error");
      return;
    }
    setTemplates((prev) => prev?.map((t) => (t.id === id ? data : t)) ?? null);
    setEditingId(null);
    show("Template updated.");
  }

  async function togglePublished(t: TemplateOut) {
    setBusyId(t.id);
    const { data, error } = await api.PATCH("/api/templates/{template_id}", {
      params: { path: { template_id: t.id } },
      body: { is_published: !t.is_published },
    });
    setBusyId(null);
    if (error || !data) {
      show((error as { detail?: string })?.detail ?? "Couldn't update that template.", "error");
      return;
    }
    setTemplates((prev) => prev?.map((x) => (x.id === t.id ? data : x)) ?? null);
  }

  async function deleteTemplate(t: TemplateOut) {
    if (!window.confirm(`Delete "${t.name}"? This can't be undone.`)) return;
    setBusyId(t.id);
    const { error } = await api.DELETE("/api/templates/{template_id}", { params: { path: { template_id: t.id } } });
    setBusyId(null);
    if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't delete that template.", "error");
      return;
    }
    setTemplates((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
  }

  if (templates === null) return <PageSpinner />;

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid size={28} aria-hidden="true" />}
        title="No templates yet"
        description="Templates contributed to the project-creation gallery will appear here."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {templates.map((t) => (
        <li key={t.id} className={styles.row}>
          {editingId === t.id ? (
            <div className={styles.editForm}>
              <TextField label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              <TextField
                label="Source URL"
                type="url"
                value={editSourceUrl}
                onChange={(e) => setEditSourceUrl(e.target.value)}
                required
              />
              <TextField label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              <TextField label="Category" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} />
              <div className={styles.actions}>
                <Button size="sm" onClick={() => saveEdit(t.id)} loading={busyId === t.id} disabled={!editName.trim() || !editSourceUrl.trim()}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={busyId === t.id}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <p className={styles.name}>{t.name}</p>
                  <span className={[styles.status, t.is_published ? styles.statusPublished : styles.statusPending].join(" ")}>
                    {t.is_published ? "Published" : "Pending review"}
                  </span>
                  {t.category && <span className={styles.category}>{t.category}</span>}
                </div>
                {t.description && <p className={styles.description}>{t.description}</p>}
                <a className={styles.source} href={t.source_url} target="_blank" rel="noreferrer">
                  {t.source_url}
                </a>
              </div>
              <div className={styles.actions}>
                <Button size="sm" variant="ghost" onClick={() => startEdit(t)} disabled={busyId === t.id}>
                  Edit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => togglePublished(t)} loading={busyId === t.id}>
                  {t.is_published ? "Unpublish" : "Publish"}
                </Button>
                <Button size="sm" variant="danger" onClick={() => deleteTemplate(t)} disabled={busyId === t.id}>
                  Delete
                </Button>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
