import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { PageSpinner } from "../components/ui/Spinner";
import styles from "./AdminPage.module.css";

type AdminUserOut = components["schemas"]["AdminUserOut"];

export function AdminPage() {
  const [users, setUsers] = useState<AdminUserOut[] | null>(null);

  useEffect(() => {
    api.GET("/api/admin/users").then(({ data }) => setUsers(data ?? []));
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <NavLink to="/projects" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
        </NavLink>
        <h1 className={styles.title}>
          <ShieldCheck size={18} aria-hidden="true" />
          Admin — Users
        </h1>
      </header>

      <main className={styles.main}>
        {users === null ? (
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
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.display_name || u.email || u.orcid_id || "—"}</td>
                  <td className={styles.mono}>{u.kind}</td>
                  <td>{u.project_count}</td>
                  <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "never"}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>{u.is_admin ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
