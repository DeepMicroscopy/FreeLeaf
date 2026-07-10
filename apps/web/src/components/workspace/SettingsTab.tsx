import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useWorkspace } from "../../lib/workspace";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import styles from "./SettingsTab.module.css";

type ProjectSettingsOut = components["schemas"]["ProjectSettingsOut"];

export function SettingsTab() {
  const { projectId, files, canWrite } = useWorkspace();
  const { show } = useToast();
  const [settings, setSettings] = useState<ProjectSettingsOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  async function save(patch: Partial<Pick<ProjectSettingsOut, "compiler" | "central_bib_path" | "bib_engine">>) {
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

  return (
    <div className={styles.root}>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Compilation</h3>

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

      {!canWrite && (
        <p className={styles.readOnlyNote}>You have view-only access — settings are managed by the project owner.</p>
      )}
    </div>
  );
}
