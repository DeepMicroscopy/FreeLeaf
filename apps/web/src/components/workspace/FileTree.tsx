import { api } from "@freeleaf/shared";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";

import { useToast } from "../ui/Toast";
import { useWorkspace } from "../../lib/workspace";
import type { ProjectFileOut } from "../../lib/workspace";
import { buildTree } from "./treeUtils";
import type { TreeNode } from "./treeUtils";
import styles from "./FileTree.module.css";

function iconFor(file: ProjectFileOut | undefined, expanded: boolean) {
  if (!file || file.type === "folder") {
    return expanded ? <FolderOpen size={15} aria-hidden="true" /> : <Folder size={15} aria-hidden="true" />;
  }
  if (file.type === "tex") return <FileText size={15} aria-hidden="true" />;
  if (file.type === "bib") return <BookOpen size={15} aria-hidden="true" />;
  if (file.type === "image") return <ImageIcon size={15} aria-hidden="true" />;
  return <FileIcon size={15} aria-hidden="true" />;
}

type Draft = { parentPath: string; kind: "file" | "folder" } | null;

export function FileTree() {
  const { projectId, files, refreshFiles, selectedFileId, selectFile, canWrite } = useWorkspace();
  const { show } = useToast();

  const tree = useMemo(() => buildTree(files), [files]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));
  const [draft, setDraft] = useState<Draft>(null);
  const [draftName, setDraftName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function startDraft(parentPath: string, kind: "file" | "folder") {
    setDraft({ parentPath, kind });
    setDraftName("");
    if (parentPath) setExpanded((prev) => new Set(prev).add(parentPath));
  }

  async function submitDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const current = draft;
    if (!current || !draftName.trim()) {
      setDraft(null);
      return;
    }
    const name = draftName.trim();
    const path = current.parentPath ? `${current.parentPath}/${name}` : name;
    setDraft(null);
    try {
      if (current.kind === "folder") {
        const { error } = await api.POST("/api/projects/{project_id}/folders", {
          params: { path: { project_id: projectId } },
          body: { path },
        });
        if (error) throw new Error();
      } else {
        const { data, error } = await api.POST("/api/projects/{project_id}/files", {
          params: { path: { project_id: projectId } },
          body: { path, content: "" },
        });
        if (error) throw new Error();
        if (data) selectFile(data.id);
      }
      await refreshFiles();
    } catch {
      show(`Could not create "${name}". It may already exist.`, "error");
    }
  }

  function startRename(node: TreeNode) {
    if (!node.file) return;
    setRenamingId(node.file.id);
    setRenameValue(node.name);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  async function submitRename(node: TreeNode) {
    const id = renamingId;
    const value = renameValue.trim();
    setRenamingId(null);
    if (!node.file || id !== node.file.id || !value || value === node.name) return;
    const newPath = node.path.split("/").slice(0, -1).concat(value).join("/");
    try {
      const { error } = await api.PATCH("/api/projects/{project_id}/files/{file_id}", {
        params: { path: { project_id: projectId, file_id: node.file.id } },
        body: { path: newPath },
      });
      if (error) throw new Error();
      await refreshFiles();
    } catch {
      show("Could not rename — that name may already be taken.", "error");
    }
  }

  async function handleDelete(node: TreeNode) {
    if (!node.file) return;
    const label = node.file.type === "folder" ? "folder and everything inside it" : "file";
    if (!window.confirm(`Delete "${node.name}" (${label})? This can't be undone.`)) return;
    try {
      await api.DELETE("/api/projects/{project_id}/files/{file_id}", {
        params: { path: { project_id: projectId, file_id: node.file.id } },
      });
      if (selectedFileId === node.file.id) selectFile(null);
      await refreshFiles();
    } catch {
      show("Could not delete that item.", "error");
    }
  }

  async function uploadFiles(fileList: FileList | File[]) {
    for (const file of Array.from(fileList)) {
      const { error } = await api.POST("/api/projects/{project_id}/files/upload", {
        params: { path: { project_id: projectId }, query: { path: file.name } },
        body: { file },
        bodySerializer: (body) => {
          const form = new FormData();
          form.append("file", body.file);
          return form;
        },
      });
      if (error) show(`Could not upload "${file.name}".`, "error");
    }
    await refreshFiles();
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
      e.target.value = "";
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }

  return (
    <div
      className={[styles.root, dragOver ? styles.dragOver : ""].join(" ")}
      onDragOver={(e) => {
        e.preventDefault();
        if (canWrite) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={canWrite ? handleDrop : undefined}
    >
      {canWrite && (
        <div className={styles.toolbar}>
          <button className={styles.toolbarButton} title="New file" onClick={() => startDraft("", "file")}>
            <FilePlus size={15} aria-hidden="true" />
          </button>
          <button
            className={styles.toolbarButton}
            title="New folder"
            onClick={() => startDraft("", "folder")}
          >
            <FolderPlus size={15} aria-hidden="true" />
          </button>
          <button
            className={styles.toolbarButton}
            title="Upload file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="visually-hidden"
            onChange={handleFileInputChange}
          />
        </div>
      )}

      <div className={styles.tree} role="tree">
        {tree.map((node) => (
          <Node
            key={node.path}
            node={node}
            depth={0}
            expanded={expanded}
            onToggle={toggle}
            selectedFileId={selectedFileId}
            onSelect={selectFile}
            canWrite={canWrite}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            onStartRename={startRename}
            onSubmitRename={submitRename}
            onCancelRename={cancelRename}
            onDelete={handleDelete}
            onStartDraftInside={startDraft}
            draft={draft}
            draftName={draftName}
            setDraftName={setDraftName}
            onSubmitDraft={submitDraft}
            onCancelDraft={() => setDraft(null)}
          />
        ))}

        {draft && draft.parentPath === "" && (
          <DraftRow
            depth={0}
            kind={draft.kind}
            value={draftName}
            onChange={setDraftName}
            onSubmit={submitDraft}
            onCancel={() => setDraft(null)}
          />
        )}

        {tree.length === 0 && !draft && <p className={styles.emptyHint}>No files yet.</p>}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  expanded,
  onToggle,
  selectedFileId,
  onSelect,
  canWrite,
  renamingId,
  renameValue,
  setRenameValue,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  onDelete,
  onStartDraftInside,
  draft,
  draftName,
  setDraftName,
  onSubmitDraft,
  onCancelDraft,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  selectedFileId: string | null;
  onSelect: (id: string) => void;
  canWrite: boolean;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onStartRename: (node: TreeNode) => void;
  onSubmitRename: (node: TreeNode) => void;
  onCancelRename: () => void;
  onDelete: (node: TreeNode) => void;
  onStartDraftInside: (parentPath: string, kind: "file" | "folder") => void;
  draft: Draft;
  draftName: string;
  setDraftName: (v: string) => void;
  onSubmitDraft: (e: FormEvent<HTMLFormElement>) => void;
  onCancelDraft: () => void;
}) {
  const isFolder = node.file?.type === "folder" || (!node.file && node.children.length > 0);
  const isOpen = expanded.has(node.path);
  const isRenaming = node.file != null && renamingId === node.file.id;

  return (
    <div>
      <div
        className={[styles.row, !isFolder && node.file?.id === selectedFileId ? styles.rowSelected : ""].join(
          " ",
        )}
        style={{ paddingLeft: 8 + depth * 16 }}
        role="treeitem"
        aria-selected={node.file?.id === selectedFileId}
      >
        <button
          type="button"
          className={styles.rowMain}
          onClick={() => (isFolder ? onToggle(node.path) : node.file && onSelect(node.file.id))}
        >
          {isFolder ? (
            <span className={styles.chevron}>
              {isOpen ? (
                <ChevronDown size={13} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} aria-hidden="true" />
              )}
            </span>
          ) : (
            <span className={styles.chevronSpacer} />
          )}
          <span className={styles.icon}>{iconFor(node.file, isOpen)}</span>
          {isRenaming ? (
            <input
              autoFocus
              className={styles.renameInput}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSubmitRename(node);
                if (e.key === "Escape") onCancelRename();
              }}
              onBlur={() => onSubmitRename(node)}
            />
          ) : (
            <span className={styles.name}>{node.name}</span>
          )}
        </button>

        {canWrite && !isRenaming && (
          <span className={styles.rowActions}>
            {isFolder && (
              <>
                <button
                  type="button"
                  className={styles.actionButton}
                  title="New file here"
                  onClick={() => onStartDraftInside(node.path, "file")}
                >
                  <FilePlus size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  title="New folder here"
                  onClick={() => onStartDraftInside(node.path, "folder")}
                >
                  <FolderPlus size={13} aria-hidden="true" />
                </button>
              </>
            )}
            <button type="button" className={styles.actionButton} title="Rename" onClick={() => onStartRename(node)}>
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button type="button" className={styles.actionButton} title="Delete" onClick={() => onDelete(node)}>
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </span>
        )}
      </div>

      {isFolder && isOpen && (
        <div>
          {node.children.map((child) => (
            <Node
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedFileId={selectedFileId}
              onSelect={onSelect}
              canWrite={canWrite}
              renamingId={renamingId}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              onStartRename={onStartRename}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onDelete={onDelete}
              onStartDraftInside={onStartDraftInside}
              draft={draft}
              draftName={draftName}
              setDraftName={setDraftName}
              onSubmitDraft={onSubmitDraft}
              onCancelDraft={onCancelDraft}
            />
          ))}
          {draft && draft.parentPath === node.path && (
            <DraftRow
              depth={depth + 1}
              kind={draft.kind}
              value={draftName}
              onChange={setDraftName}
              onSubmit={onSubmitDraft}
              onCancel={onCancelDraft}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DraftRow({
  depth,
  kind,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number;
  kind: "file" | "folder";
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className={styles.row} style={{ paddingLeft: 8 + depth * 16 }} onSubmit={onSubmit}>
      <span className={styles.chevronSpacer} />
      <span className={styles.icon}>
        {kind === "folder" ? <Folder size={15} aria-hidden="true" /> : <FileIcon size={15} aria-hidden="true" />}
      </span>
      <input
        autoFocus
        className={styles.renameInput}
        placeholder={kind === "folder" ? "folder-name" : "file.tex"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
      />
    </form>
  );
}
