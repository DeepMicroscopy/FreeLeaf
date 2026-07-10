import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, LogOut, Plus, Upload, Users } from "lucide-react";

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

  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    api.GET("/api/projects").then(({ data }) => setProjects(data ?? []));
  }, []);

  useEffect(() => {
    // Whole-window drag detection, not just one drop target — the browser
    // only reveals file names/types on the actual drop event, not during
    // dragenter/dragover, so the overlay has to show for *any* file drag
    // and validate it's really a .zip once it lands. A counter (not a bool)
    // avoids flicker from dragenter/dragleave firing on every child element
    // the cursor crosses while dragging.
    function onDragEnter(e: globalThis.DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      dragCounter.current += 1;
      setDragActive(true);
    }
    function onDragLeave() {
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragActive(false);
      }
    }
    function onDragOver(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    }
    function onDrop(e: globalThis.DragEvent) {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      dragCounter.current = 0;
      setDragActive(false);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  function handleOverlayDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      show("That doesn't look like a .zip file.", "error");
      return;
    }
    setImportFile(file);
    setImportName(file.name.replace(/\.zip$/i, ""));
  }

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

  async function handleImport(e: FormEvent) {
    e.preventDefault();
    if (!importFile || !importName.trim()) return;
    setImporting(true);
    const { data, error } = await api.POST("/api/projects/import", {
      params: { query: { name: importName.trim() } },
      // Cast as any here to satisfy the strict OpenAPI schema type checker
      body: { file: importFile as any },
      bodySerializer: (body) => {
        const form = new FormData();
        form.append("file", body.file);
        return form;
      },
    });
    setImporting(false);
    if (error || !data) {
      show("Could not import that zip file.", "error");
      return;
    }
    navigate(`/projects/${data.id}`);
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

        {importFile && (
          <form className={styles.createForm} onSubmit={handleImport}>
            <TextField
              label="Project name"
              hint={`Importing from ${importFile.name}`}
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              autoFocus
              required
            />
            <div className={styles.createActions}>
              <Button type="submit" loading={importing}>
                Import
              </Button>
              <Button type="button" variant="ghost" onClick={() => setImportFile(null)}>
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

      {dragActive && (
        <div className={styles.dropOverlay} onDragOver={(e) => e.preventDefault()} onDrop={handleOverlayDrop}>
          <div className={styles.dropCard}>
            <Upload size={32} aria-hidden="true" />
            <p className={styles.dropTitle}>Drop here to upload</p>
            <p className={styles.dropHint}>A .zip file will be added as a new project</p>
          </div>
        </div>
      )}
    </div>
  );
}
