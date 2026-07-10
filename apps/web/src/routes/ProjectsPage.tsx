import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, LogOut, Plus, Users } from "lucide-react";

import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { EmptyState } from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/Toast";
import { useAuth } from "../lib/auth";
import styles from "./ProjectsPage.module.css";

type ProjectOut = components["schemas"]["ProjectOut"];

export function ProjectsPage() {
  const { user, logout } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectOut[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.GET("/api/projects").then(({ data }) => setProjects(data ?? []));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await api.POST("/api/projects", { body: { name: newName.trim() } });
      if (error || !data) throw new Error("failed");
      navigate(`/projects/${data.id}`);
    } catch {
      show("Could not create the project. Please try again.", "error");
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span aria-hidden="true">🍃</span>
          <span className={styles.brandName}>FreeLeaf</span>
        </div>
        <div className={styles.userMenu}>
          <span className={styles.userName}>{user?.display_name ?? user?.email ?? "Anonymous"}</span>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>Your projects</h1>
          <Button onClick={() => setCreating((c) => !c)}>
            <Plus size={16} aria-hidden="true" />
            New project
          </Button>
        </div>

        {creating && (
          <form className={styles.createForm} onSubmit={handleCreate}>
            <TextField
              label="Project name"
              placeholder="My thesis"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              required
            />
            <div className={styles.createActions}>
              <Button type="submit" loading={submitting}>
                Create
              </Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {projects === null ? (
          <PageSpinner />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<FileText size={32} aria-hidden="true" />}
            title="No projects yet"
            description="Create your first project to start writing in LaTeX with a live PDF preview."
            action={<Button onClick={() => setCreating(true)}>Create a project</Button>}
          />
        ) : (
          <ul className={styles.grid}>
            {projects.map((p) => (
              <li key={p.id}>
                <button className={styles.card} onClick={() => navigate(`/projects/${p.id}`)}>
                  <div className={styles.cardIcon}>
                    <FileText size={20} aria-hidden="true" />
                  </div>
                  <div className={styles.cardBody}>
                    <p className={styles.cardName}>{p.name}</p>
                    <p className={styles.cardMeta}>
                      <Users size={12} aria-hidden="true" />
                      {p.role}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
