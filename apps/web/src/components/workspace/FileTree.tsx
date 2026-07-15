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
import { FILE_SIZE_WARN_BYTES } from "./fileSize";
import { uploadSingleFile } from "./fileUpload";
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

// Mirrors the backend's path segment rule (projects/paths.py: letters,
// numbers, spaces, dots, underscores, hyphens) — uploaded files keep
// whatever name they arrived with, so rather than rejecting an upload
// outright we rewrite disallowed characters instead of forcing the user
// to rename the file themselves before retrying.
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ._-]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "file";
}

function errorMessage(error: unknown, fallback: string): string {
  return (error as { detail?: string } | undefined)?.detail ?? fallback;
}

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
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef("");

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

async function uploadFiles(fileList: FileList | File[], targetFolder = "") {
    for (const file of Array.from(fileList)) {
      const name = sanitizeFileName(file.name);
      const path = targetFolder ? `${targetFolder}/${name}` : name;
      const { error } = await uploadSingleFile(projectId, path, file);
      if (error) show(`Could not upload "${file.name}": ${errorMessage(error, "unknown error")}`, "error");
    }
    await refreshFiles();
  }

  function triggerUpload(targetFolder: string) {
    uploadTargetRef.current = targetFolder;
    fileInputRef.current?.click();
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files, uploadTargetRef.current);
      e.target.value = "";
    }
    uploadTargetRef.current = "";
  }

  async function moveFile(fileId: string, targetFolder: string) {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    const slash = file.path.lastIndexOf("/");
    const name = slash === -1 ? file.path : file.path.slice(slash + 1);
    const currentParent = slash === -1 ? "" : file.path.slice(0, slash);
    if (currentParent === targetFolder) return;
    if (file.type === "folder" && (targetFolder === file.path || targetFolder.startsWith(file.path + "/"))) {
      show("Can't move a folder into itself.", "error");
      return;
    }
    const newPath = targetFolder ? `${targetFolder}/${name}` : name;
    try {
      const { error } = await api.PATCH("/api/projects/{project_id}/files/{file_id}", {
        params: { path: { project_id: projectId, file_id: fileId } },
        body: { path: newPath },
      });
      if (error) throw new Error(errorMessage(error, "That name may already be taken."));
      await refreshFiles();
    } catch (e) {
      show(`Could not move "${name}": ${e instanceof Error ? e.message : "unknown error"}`, "error");
    }
  }

  function handleDropAt(targetFolder: string, e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setDragOverFolder(null);
    const movingId = e.dataTransfer.getData("application/x-freeleaf-file-id");
    if (movingId) {
      moveFile(movingId, targetFolder);
    } else if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files, targetFolder);
    }
  }

  function handleDrop(e: DragEvent) {
    handleDropAt("", e);
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
            onClick={() => triggerUpload("")}
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
            onUploadInto={triggerUpload}
            dragOverFolder={dragOverFolder}
            onDragOverFolder={setDragOverFolder}
            onDropAt={handleDropAt}
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
  onUploadInto,
  dragOverFolder,
  onDragOverFolder,
  onDropAt,
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
  onUploadInto: (targetFolder: string) => void;
  dragOverFolder: string | null;
  onDragOverFolder: (path: string | null) => void;
  onDropAt: (targetFolder: string, e: DragEvent) => void;
}) {
  const isFolder = node.file?.type === "folder" || (!node.file && node.children.length > 0);
  const isOpen = expanded.has(node.path);
  const isRenaming = node.file != null && renamingId === node.file.id;

  return (
    <div>
      <div
        className={[
          styles.row,
          !isFolder && node.file?.id === selectedFileId ? styles.rowSelected : "",
          isFolder && dragOverFolder === node.path ? styles.rowDragOver : "",
        ].join(" ")}
        style={{ paddingLeft: 8 + depth * 16 }}
        role="treeitem"
        aria-selected={node.file?.id === selectedFileId}
        draggable={canWrite && node.file != null && !isRenaming}
        onDragStart={(e) => {
          if (!node.file) return;
          e.dataTransfer.setData("application/x-freeleaf-file-id", node.file.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!canWrite || !isFolder) return;
          e.preventDefault();
          e.stopPropagation();
          onDragOverFolder(node.path);
        }}
        onDragLeave={() => onDragOverFolder(null)}
        onDrop={(e) => {
          if (!canWrite || !isFolder) return;
          onDropAt(node.path, e);
        }}
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
            <span
              className={[
                styles.name,
                node.file && node.file.type !== "folder" && node.file.size > FILE_SIZE_WARN_BYTES
                  ? styles.nameWarn
                  : "",
              ].join(" ")}
            >
              {node.name}
            </span>
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
                <button
                  type="button"
                  className={styles.actionButton}
                  title="Upload here"
                  onClick={() => onUploadInto(node.path)}
                >
                  <Upload size={13} aria-hidden="true" />
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
              onUploadInto={onUploadInto}
              dragOverFolder={dragOverFolder}
              onDragOverFolder={onDragOverFolder}
              onDropAt={onDropAt}
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
