import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { ClipboardList } from "lucide-react";
import styles from "./PendingTemplatesPanel.module.css";

type TemplateOut = components["schemas"]["TemplateOut"];
type SiteSettingsOut = components["schemas"]["SiteSettingsOut"];

export function PendingTemplatesPanel() {
  const { show } = useToast();
  const [settings, setSettings] = useState<SiteSettingsOut | null>(null);
  const [pending, setPending] = useState<TemplateOut[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [settingsRes, pendingRes] = await Promise.all([
      api.GET("/api/admin/site-settings"),
      api.GET("/api/templates/pending"),
    ]);
    setSettings(settingsRes.data ?? null);
    setPending(pendingRes.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(t: TemplateOut) {
    setBusyId(t.id);
    const { error } = await api.POST("/api/templates/{template_id}/publish", { params: { path: { template_id: t.id } } });
    setBusyId(null);
    if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't approve that template.", "error");
      return;
    }
    setPending((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
    show(`"${t.name}" published to the gallery.`);
  }

  async function reject(t: TemplateOut) {
    if (!window.confirm(`Reject and delete "${t.name}"? This can't be undone.`)) return;
    setBusyId(t.id);
    const { error } = await api.DELETE("/api/templates/{template_id}", { params: { path: { template_id: t.id } } });
    setBusyId(null);
    if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't reject that template.", "error");
      return;
    }
    setPending((prev) => prev?.filter((x) => x.id !== t.id) ?? null);
  }

  if (!settings || pending === null) return <PageSpinner />;

  if (settings.template_contribution_mode !== "review_required") {
    return (
      <EmptyState
        icon={<ClipboardList size={28} aria-hidden="true" />}
        title="No review queue needed"
        description={
          settings.template_contribution_mode === "admin_only"
            ? "Template contributions are set to admins-only, so nothing needs review — anything an admin adds is published immediately."
            : "Template contributions are set to publish immediately, so nothing needs review."
        }
      />
    );
  }

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={28} aria-hidden="true" />}
        title="Nothing pending"
        description="No submitted templates are waiting for review right now."
      />
    );
  }

  return (
    <ul className={styles.list}>
      {pending.map((t) => (
        <li key={t.id} className={styles.row}>
          <div className={styles.info}>
            <p className={styles.name}>{t.name}</p>
            {t.description && <p className={styles.description}>{t.description}</p>}
            <a className={styles.source} href={t.source_url} target="_blank" rel="noreferrer">
              {t.source_url}
            </a>
          </div>
          <div className={styles.actions}>
            <Button size="sm" onClick={() => approve(t)} loading={busyId === t.id}>
              Approve
            </Button>
            <Button size="sm" variant="danger" onClick={() => reject(t)} disabled={busyId === t.id}>
              Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
