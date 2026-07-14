import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { TemplatesAdminPanel } from "../components/admin/TemplatesAdminPanel";
import { SiteSettingsPanel } from "../components/admin/SiteSettingsPanel";
import { SsoProvidersPanel } from "../components/admin/SsoProvidersPanel";
import { Button } from "../components/ui/Button";
import { PageSpinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/Toast";
import { useAuth } from "../lib/auth";
import styles from "./AdminPage.module.css";

type AdminUserOut = components["schemas"]["AdminUserOut"];

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const { show } = useToast();
  const [users, setUsers] = useState<AdminUserOut[] | null>(null);
  const [tab, setTab] = useState<"users" | "sso" | "site" | "templates">("users");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    const { data } = await api.GET("/api/admin/users");
    setUsers(data ?? []);
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function toggleAdmin(u: AdminUserOut) {
    setBusyId(u.id);
    const { data, error } = await api.PATCH("/api/admin/users/{user_id}", {
      params: { path: { user_id: u.id } },
      body: { is_admin: !u.is_admin },
    });
    setBusyId(null);
    if (data) {
      setUsers((prev) => prev?.map((x) => (x.id === u.id ? data : x)) ?? null);
    } else if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't update that user.", "error");
    }
  }

  async function removeUser(u: AdminUserOut) {
    const label = u.display_name || u.email || u.orcid_id || "this user";
    if (!confirm(`Remove ${label}? This deletes their account. Any projects they own are kept, just ownerless.`)) {
      return;
    }
    setBusyId(u.id);
    const { error } = await api.DELETE("/api/admin/users/{user_id}", { params: { path: { user_id: u.id } } });
    setBusyId(null);
    if (error) {
      show((error as { detail?: string }).detail ?? "Couldn't remove that user.", "error");
      return;
    }
    setUsers((prev) => prev?.filter((x) => x.id !== u.id) ?? null);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <NavLink to="/projects" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
        </NavLink>
        <h1 className={styles.title}>
          <ShieldCheck size={18} aria-hidden="true" />
          Admin
        </h1>
        <nav className={styles.tabs}>
          <button
            className={[styles.tab, tab === "users" ? styles.tabActive : ""].join(" ")}
            onClick={() => setTab("users")}
          >
            Users
          </button>
          <button
            className={[styles.tab, tab === "sso" ? styles.tabActive : ""].join(" ")}
            onClick={() => setTab("sso")}
          >
            SSO Providers
          </button>
          <button
            className={[styles.tab, tab === "site" ? styles.tabActive : ""].join(" ")}
            onClick={() => setTab("site")}
          >
            Site Settings
          </button>
          <button
            className={[styles.tab, tab === "templates" ? styles.tabActive : ""].join(" ")}
            onClick={() => setTab("templates")}
          >
            Templates
          </button>
        </nav>
      </header>

      <main className={styles.main}>
        {tab === "site" ? (
          <SiteSettingsPanel />
        ) : tab === "sso" ? (
          <SsoProvidersPanel />
        ) : tab === "templates" ? (
          <TemplatesAdminPanel />
        ) : users === null ? (
          <PageSpinner />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Projects</th>
                <th>Last active</th>
                <th>Joined</th>
                <th>Admin</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.display_name || u.email || u.orcid_id || "—"}
                    {u.id === currentUser?.id && <span className={styles.mono}> (you)</span>}
                  </td>
                  <td className={styles.mono}>{u.kind}</td>
                  <td>{u.project_count}</td>
                  <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "never"}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>{u.is_admin ? "✓" : ""}</td>
                  <td className={styles.actions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === u.id}
                      onClick={() => void toggleAdmin(u)}
                    >
                      {u.is_admin ? "Revoke admin" : "Make admin"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busyId === u.id}
                      onClick={() => void removeUser(u)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
