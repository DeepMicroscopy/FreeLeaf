import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { PageSpinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { OrcidMark } from "../auth/OrcidMark";
import styles from "./SiteSettingsPanel.module.css";

type SiteSettingsOut = components["schemas"]["SiteSettingsOut"];

export function SiteSettingsPanel() {
  const { show } = useToast();
  const [settings, setSettings] = useState<SiteSettingsOut | null>(null);
  const [saving, setSaving] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/site-settings");
    setSettings(data ?? null);
    if (data) setSiteName(data.site_name);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleOrcid() {
    if (!settings) return;
    setSaving(true);
    const { data, error } = await api.PUT("/api/admin/site-settings", {
      body: { orcid_enabled: !settings.orcid_enabled, site_name: settings.site_name },
    });
    setSaving(false);
    if (data) {
      setSettings(data);
      show(data.orcid_enabled ? "ORCID sign-in enabled." : "ORCID sign-in disabled.");
    } else if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't update site settings.", "error");
    }
  }

  async function saveSiteName() {
    if (!settings || !siteName.trim()) return;
    setSavingName(true);
    const { data, error } = await api.PUT("/api/admin/site-settings", {
      body: { orcid_enabled: settings.orcid_enabled, site_name: siteName.trim() },
    });
    setSavingName(false);
    if (data) {
      setSettings(data);
      setSiteName(data.site_name);
      show("Site name updated.");
    } else if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't update site settings.", "error");
    }
  }

  if (!settings) return <PageSpinner />;

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3 className={styles.cardTitle}>Site name</h3>
            <p className={styles.cardHint}>Shown next to the leaf icon throughout the app, instead of "FreeLeaf".</p>
          </div>
        </div>
        <div className={styles.nameRow}>
          <TextField
            label="Site name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            maxLength={100}
          />
          <Button onClick={() => void saveSiteName()} loading={savingName} disabled={!siteName.trim()}>
            Save
          </Button>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <OrcidMark />
          <div>
            <h3 className={styles.cardTitle}>ORCID sign-in</h3>
            <p className={styles.cardHint}>
              {settings.orcid_configured
                ? "Lets anyone sign in with their ORCID iD."
                : "Not configured — set ORCID_CLIENT_ID/ORCID_CLIENT_SECRET before enabling this."}
            </p>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={settings.orcid_enabled}
              disabled={saving || !settings.orcid_configured}
              onChange={() => void toggleOrcid()}
            />
            <span className={styles.toggleTrack}>
              <span className={styles.toggleThumb} />
            </span>
          </label>
        </div>
        <p className={styles.footnote}>
          Institutional SSO providers (the "SSO Providers" tab) are configured separately and aren't affected by this
          toggle. Disabling ORCID is blocked while no SSO provider is enabled, so there's always at least one way to
          sign in.
        </p>
      </section>
    </div>
  );
}
