import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { SsoProviderForm } from "./SsoProviderForm";
import type { SsoProviderFormValues } from "./SsoProviderForm";
import styles from "./SsoProvidersPanel.module.css";

type SsoProviderAdminOut = components["schemas"]["SsoProviderAdminOut"];

export function SsoProvidersPanel() {
  const { show } = useToast();
  const [providers, setProviders] = useState<SsoProviderAdminOut[] | null>(null);
  const [editing, setEditing] = useState<SsoProviderAdminOut | null | "new">(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/admin/sso-providers");
    setProviders(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(
    async (values: SsoProviderFormValues) => {
      setSubmitting(true);
      if (editing === "new") {
        const { data, error } = await api.POST("/api/admin/sso-providers", { body: values });
        setSubmitting(false);
        if (data) {
          show(`Added "${data.name}".`);
          setEditing(null);
          void load();
        } else if (error) {
          show((error as { detail?: string }).detail ?? "Couldn't create the provider.", "error");
        }
        return;
      }
      if (editing) {
        const { data, error } = await api.PATCH("/api/admin/sso-providers/{provider_id}", {
          params: { path: { provider_id: editing.id } },
          body: values,
        });
        setSubmitting(false);
        if (data) {
          show(`Saved "${data.name}".`);
          setEditing(null);
          void load();
        } else if (error) {
          show((error as { detail?: string }).detail ?? "Couldn't save the provider.", "error");
        }
      }
    },
    [editing, show, load],
  );

  const handleDelete = useCallback(
    async (provider: SsoProviderAdminOut) => {
      if (!confirm(`Remove "${provider.name}"? Users who signed in through it keep their account, but can no longer sign in this way.`)) {
        return;
      }
      const { error } = await api.DELETE("/api/admin/sso-providers/{provider_id}", {
        params: { path: { provider_id: provider.id } },
      });
      if (!error) {
        show("Provider removed.");
        void load();
      }
    },
    [show, load],
  );

  if (providers === null) {
    return (
      <div className={styles.centered}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.hint}>Institutions that can sign in via SAML (Shibboleth) or LDAP/Active Directory.</p>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus size={14} aria-hidden="true" />
          Add provider
        </Button>
      </div>

      {providers.length === 0 ? (
        <EmptyState title="No SSO providers yet" description="Add one to let an institution's users sign in with their own credentials." />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Slug</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className={styles.nameLink} onClick={() => setEditing(p)}>
                    {p.name}
                  </button>
                </td>
                <td className={styles.mono}>{p.kind === "saml" ? "SAML" : "LDAP/AD"}</td>
                <td className={styles.mono}>{p.slug}</td>
                <td>
                  <span className={[styles.statusBadge, p.enabled ? styles.enabled : styles.disabled].join(" ")}>
                    {p.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td>
                  <button className={styles.deleteButton} onClick={() => handleDelete(p)} title="Remove provider">
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className={styles.overlay} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true" aria-label="SSO provider">
            <h3 className={styles.modalTitle}>{editing === "new" ? "Add SSO provider" : `Edit "${editing.name}"`}</h3>
            <SsoProviderForm
              initial={editing === "new" ? null : editing}
              onSubmit={handleSubmit}
              onCancel={() => setEditing(null)}
              submitting={submitting}
            />
          </div>
        </div>
      )}
    </div>
  );
}
