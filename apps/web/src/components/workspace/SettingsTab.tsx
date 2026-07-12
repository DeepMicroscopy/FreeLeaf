import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useWorkspace } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import styles from "./SettingsTab.module.css";

type ProjectSettingsOut = components["schemas"]["ProjectSettingsOut"];

export function SettingsTab() {
  const { projectId, project, files, canWrite, refreshProject } = useWorkspace();
  const { show } = useToast();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ProjectSettingsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(project?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setName(project?.name ?? "");
  }, [project?.name]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project?.name) return;
    setSavingName(true);
    const { data, error } = await api.PATCH("/api/projects/{project_id}", {
      params: { path: { project_id: projectId } },
      body: { name: trimmed },
    });
    setSavingName(false);
    if (error || !data) {
      show("Couldn't rename the project.", "error");
      return;
    }
    await refreshProject();
    show("Project renamed.");
  }

  async function deleteProject() {
    if (!window.confirm(`Delete "${project?.name}"? This can't be undone — all files, history, and comments go with it.`)) {
      return;
    }
    setDeleting(true);
    const { error } = await api.DELETE("/api/projects/{project_id}", {
      params: { path: { project_id: projectId } },
    });
    setDeleting(false);
    if (error) {
      show("Couldn't delete the project.", "error");
      return;
    }
    navigate("/projects", { replace: true });
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await api.GET("/api/projects/{project_id}/settings", {
        params: { path: { project_id: projectId } },
      });
      if (!cancelled) {
        setSettings(data ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function save(
    patch: Partial<
      Pick<
        ProjectSettingsOut,
        "compiler" | "central_bib_path" | "bib_engine" | "cite_autocomplete_enabled" | "main_doc_path"
      >
    >,
  ) {
    setSaving(true);
    const { data, error } = await api.PATCH("/api/projects/{project_id}/settings", {
      params: { path: { project_id: projectId } },
      body: patch,
    });
    setSaving(false);
    if (error || !data) {
      show("Couldn't save that setting.", "error");
      return;
    }
    setSettings(data);
    show("Settings saved.");
  }

  if (loading) return <PageSpinner />;
  if (!settings) {
    return (
      <EmptyState
        icon={<Settings2 size={32} aria-hidden="true" />}
        title="Couldn't load settings"
        description="Try reloading the page."
      />
    );
  }

  const bibFiles = files.filter((f) => f.type === "bib");
  const texFiles = files.filter((f) => f.type === "tex");

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>General</h3>

        <div className={styles.nameRow}>
          <TextField
            label="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canWrite || savingName}
          />
          {canWrite && (
            <Button onClick={() => void saveName()} loading={savingName} disabled={!name.trim() || name.trim() === project?.name}>
              Save
            </Button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Compilation</h3>

        <label className={styles.field}>
          <span className={styles.label}>Main document</span>
          <select
            className={styles.select}
            value={settings.main_doc_path}
            disabled={!canWrite || saving}
            onChange={(e) => save({ main_doc_path: e.target.value })}
          >
            {texFiles.length === 0 && <option value={settings.main_doc_path}>{settings.main_doc_path}</option>}
            {texFiles.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
          <span className={styles.hint}>The file compiled to produce the project's PDF.</span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>PDF compiler</span>
          <select
            className={styles.select}
            value={settings.compiler}
            disabled={!canWrite || saving}
            onChange={(e) => save({ compiler: e.target.value })}
          >
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Central .bib file</span>
          <select
            className={styles.select}
            value={settings.central_bib_path ?? ""}
            disabled={!canWrite || saving}
            onChange={(e) => save({ central_bib_path: e.target.value || null })}
          >
            {bibFiles.length === 0 && <option value="">No .bib files in this project</option>}
            {bibFiles.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            Used by the Library tab and <code>\cite&#123;&#125;</code> autocomplete in the editor.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Bibliography engine</span>
          <select
            className={styles.select}
            value={settings.bib_engine}
            disabled={!canWrite || saving}
            onChange={(e) => save({ bib_engine: e.target.value })}
          >
            <option value="bibtex">BibTeX</option>
            <option value="biber">Biber</option>
          </select>
          <span className={styles.hint}>
            latexmk auto-detects which one actually runs from your document's own packages —{" "}
            <code>\usepackage&#123;biblatex&#125;</code> uses Biber, a traditional{" "}
            <code>\bibliographystyle&#123;&#125;</code> uses BibTeX. This doesn't override that; it just tracks
            which workflow this project uses.
          </span>
        </label>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Editor</h3>

        <label className={styles.checkboxField}>
          <input
            type="checkbox"
            checked={settings.cite_autocomplete_enabled}
            disabled={!canWrite || saving}
            onChange={(e) => save({ cite_autocomplete_enabled: e.target.checked })}
          />
          <span>
            <span className={styles.label}>Autocomplete suggestions</span>
            <span className={styles.hint}>
              Shows a completion list of cite keys (with title/author) while typing{" "}
              <code>\cite&#123;&#125;</code> and its variants in the editor.
            </span>
          </span>
        </label>
      </section>

      {!canWrite && (
        <p className={styles.readOnlyNote}>You have view-only access — settings are managed by the project owner.</p>
      )}

      {project?.role === "owner" && (
        <section className={[styles.section, styles.dangerZone].join(" ")}>
          <h3 className={styles.sectionTitle}>Danger zone</h3>
          <div className={styles.dangerRow}>
            <span>
              <span className={styles.label}>Delete this project</span>
              <span className={styles.hint}>Permanently deletes all files, history, and comments. Can't be undone.</span>
            </span>
            <Button variant="danger" onClick={() => void deleteProject()} loading={deleting}>
              Delete project
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
