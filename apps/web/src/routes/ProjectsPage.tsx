import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { FilePlus, FileText, Github, LayoutGrid, LogOut, Plus, ShieldCheck, Upload, Users } from "lucide-react";

import { ContributeTemplateForm } from "../components/templates/ContributeTemplateForm";
import { TemplateGallery } from "../components/templates/TemplateGallery";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { EmptyState } from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/Toast";
import { useAuth } from "../lib/auth";
import { useSiteInfo } from "../lib/siteInfo";
import styles from "./ProjectsPage.module.css";

type ProjectOut = components["schemas"]["ProjectOut"];
type ChooserMode = "closed" | "choose" | "blank" | "template" | "github";

function parseGithubRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function ProjectsPage() {
  const { user, logout } = useAuth();
  const { siteName, templateContributionMode } = useSiteInfo();
  const { show } = useToast();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectOut[] | null>(null);
  const [mode, setMode] = useState<ChooserMode>("closed");
  const [contributingTemplate, setContributingTemplate] = useState(false);
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [githubRepo, setGithubRepo] = useState("");
  const [githubName, setGithubName] = useState("");
  const [githubSubmitting, setGithubSubmitting] = useState(false);

  const [dragActive, setDragActive] = useState(false);
  const dragCounter = useRef(0);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const canContributeTemplates =
    templateContributionMode !== "admin_only" || Boolean(user?.is_admin);

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

  function handleZipFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportFile(file);
    setImportName(file.name.replace(/\.zip$/i, ""));
    setMode("closed");
  }

  async function handleGithubImport(e: FormEvent) {
    e.preventDefault();
    const parsed = parseGithubRepo(githubRepo);
    if (!parsed || !githubName.trim()) {
      show('Enter a GitHub repo as "owner/repo" or a full github.com URL.', "error");
      return;
    }
    setGithubSubmitting(true);
    const { data, error } = await api.POST("/api/projects/from-github", {
      body: { name: githubName.trim(), owner: parsed.owner, repo: parsed.repo },
    });
    setGithubSubmitting(false);
    if (error || !data) {
      show((error as { detail?: string })?.detail ?? "Could not import that repository.", "error");
      return;
    }
    navigate(`/projects/${data.id}`);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span aria-hidden="true">🍃</span>
          <span className={styles.brandName}>{siteName}</span>
        </div>
        <div className={styles.userMenu}>
          <span className={styles.userName}>{user?.display_name ?? user?.email ?? "Anonymous"}</span>
          {user?.is_admin && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin")}>
              <ShieldCheck size={14} aria-hidden="true" />
              Admin
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.titleRow}>
          <h1 className={styles.pageTitle}>Your projects</h1>
          <Button onClick={() => setMode((m) => (m === "closed" ? "choose" : "closed"))}>
            <Plus size={16} aria-hidden="true" />
            New project
          </Button>
        </div>

        <input ref={zipInputRef} type="file" accept=".zip" className="visually-hidden" onChange={handleZipFileChosen} />

        {mode === "choose" && (
          <div className={styles.chooser}>
            <button type="button" className={styles.chooserOption} onClick={() => setMode("blank")}>
              <FilePlus size={22} aria-hidden="true" />
              Blank
            </button>
            <button
              type="button"
              className={styles.chooserOption}
              onClick={() => {
                setContributingTemplate(false);
                setMode("template");
              }}
            >
              <LayoutGrid size={22} aria-hidden="true" />
              From template
            </button>
            <button type="button" className={styles.chooserOption} onClick={() => setMode("github")}>
              <Github size={22} aria-hidden="true" />
              From GitHub
            </button>
            <button type="button" className={styles.chooserOption} onClick={() => zipInputRef.current?.click()}>
              <Upload size={22} aria-hidden="true" />
              Upload zip
            </button>
          </div>
        )}

        {mode === "blank" && (
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
              <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
                Back
              </Button>
            </div>
          </form>
        )}

        {mode === "github" && (
          <form className={styles.createForm} onSubmit={handleGithubImport}>
            <TextField
              label="GitHub repository"
              placeholder="owner/repo or https://github.com/owner/repo"
              hint="Public repositories only."
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              autoFocus
              required
            />
            <TextField
              label="Project name"
              value={githubName}
              onChange={(e) => setGithubName(e.target.value)}
              required
            />
            <div className={styles.createActions}>
              <Button type="submit" loading={githubSubmitting}>
                Import
              </Button>
              <Button type="button" variant="ghost" onClick={() => setMode("choose")}>
                Back
              </Button>
            </div>
          </form>
        )}

        {mode === "template" && (
          <div className={styles.templatePanel}>
            {contributingTemplate ? (
              <ContributeTemplateForm onDone={() => setContributingTemplate(false)} onCancel={() => setContributingTemplate(false)} />
            ) : (
              <>
                <TemplateGallery onCreated={(id) => navigate(`/projects/${id}`)} onCancel={() => setMode("choose")} />
                {canContributeTemplates && (
                  <Button variant="ghost" size="sm" onClick={() => setContributingTemplate(true)}>
                    Contribute a template
                  </Button>
                )}
              </>
            )}
          </div>
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
            action={<Button onClick={() => setMode("choose")}>Create a project</Button>}
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
                    <p className={styles.cardActivity} title={new Date(p.updated_at).toLocaleString()}>
                      {p.last_edited_by_name ? `Changed by ${p.last_edited_by_name}` : "Changed"}
                      {" · "}
                      {new Date(p.updated_at).toLocaleDateString()}
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
