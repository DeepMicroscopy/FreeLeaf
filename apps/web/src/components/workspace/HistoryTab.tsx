import { api, apiOrigin } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { History, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import styles from "./HistoryTab.module.css";

type SnapshotOut = components["schemas"]["SnapshotOut"];

export function HistoryTab() {
  const { projectId, files, selectedFileId, canWrite, refreshFiles } = useWorkspace();
  const { show } = useToast();
  const selectedFile = files.find((f) => f.id === selectedFileId);

  const [snapshots, setSnapshots] = useState<SnapshotOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null);
  const [currentContent, setCurrentContent] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSnapshots = useCallback(async () => {
    setLoading(true);
    const { data } = await api.GET("/api/projects/{project_id}/snapshots", {
      params: { path: { project_id: projectId } },
    });
    setSnapshots(data ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

  useEffect(() => {
    setSelectedId(null);
    setSnapshotContent(null);
    setCurrentContent(null);
  }, [selectedFileId]);

  useEffect(() => {
    if (!selectedId || !selectedFile || selectedFile.type === "folder" || selectedFile.type === "image") return;
    let cancelled = false;
    setDiffLoading(true);
    (async () => {
      const [snapRes, curRes] = await Promise.all([
        api.GET("/api/projects/{project_id}/snapshots/{snapshot_id}/file-content", {
          params: { path: { project_id: projectId, snapshot_id: selectedId }, query: { path: selectedFile.path } },
        }),
        fetch(`${apiOrigin()}/api/projects/${projectId}/files/${selectedFile.id}/content`, {
          credentials: "include",
        }).then((r) => (r.ok ? r.text() : null)),
      ]);
      if (cancelled) return;
      setSnapshotContent(snapRes.data?.content ?? null);
      setCurrentContent(curRes);
      setDiffLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedFile, projectId]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const { data } = await api.POST("/api/projects/{project_id}/snapshots", {
      params: { path: { project_id: projectId } },
      body: { kind: "manual", label, description },
    });
    setSaving(false);
    if (data) {
      show("Version saved.");
      setShowSaveForm(false);
      setLabel("");
      setDescription("");
      void loadSnapshots();
    }
  }, [projectId, label, description, show, loadSnapshots]);

  const handleRestore = useCallback(async () => {
    if (!selectedId) return;
    setRestoring(true);
    const { data } = await api.POST("/api/projects/{project_id}/snapshots/{snapshot_id}/restore", {
      params: { path: { project_id: projectId, snapshot_id: selectedId } },
    });
    setRestoring(false);
    setConfirmingRestore(false);
    if (data) {
      show("Restored. A backup of the previous state was saved automatically.");
      await refreshFiles();
      await loadSnapshots();
      // Live content just changed underneath us — refetch the diff view.
      setSelectedId(selectedId);
    }
  }, [projectId, selectedId, show, refreshFiles, loadSnapshots]);

  if (loading) {
    return (
      <div className={styles.centered}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      <div className={styles.list}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Version history</h2>
          {canWrite && (
            <Button variant="secondary" size="sm" onClick={() => setShowSaveForm((s) => !s)}>
              <Save size={14} aria-hidden="true" />
              Save a version
            </Button>
          )}
        </div>

        {showSaveForm && (
          <div className={styles.saveForm}>
            <input
              className={styles.saveInput}
              placeholder="Label (e.g. Draft submitted to advisor)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
            <textarea
              className={styles.saveTextarea}
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
            <div className={styles.saveActions}>
              <Button variant="ghost" size="sm" onClick={() => setShowSaveForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} loading={saving} disabled={!label.trim()}>
                Save
              </Button>
            </div>
          </div>
        )}

        {snapshots.length === 0 ? (
          <EmptyState
            icon={<History size={28} aria-hidden="true" />}
            title="No versions yet"
            description="Named and automatic checkpoints of this project will show up here."
          />
        ) : (
          <ul className={styles.snapshotList}>
            {snapshots.map((s) => (
              <li key={s.id}>
                <button
                  className={[styles.snapshotItem, s.id === selectedId ? styles.snapshotItemActive : ""].join(" ")}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className={styles.snapshotRow}>
                    <span className={[styles.kindBadge, s.kind === "manual" ? styles.kindManual : ""].join(" ")}>
                      {s.kind === "manual" ? "Named" : "Auto"}
                    </span>
                    <span className={styles.snapshotLabel}>{s.label || "Automatic snapshot"}</span>
                  </div>
                  <div className={styles.snapshotMeta}>
                    {new Date(s.created_at).toLocaleString()}
                    {s.created_by_name ? ` · ${s.created_by_name}` : ""}
                  </div>
                  {s.description && <div className={styles.snapshotDesc}>{s.description}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.detail}>
        {!selectedFile ? (
          <EmptyState title="No file selected" description="Choose a file from the sidebar to see its history." />
        ) : !selectedId ? (
          <EmptyState title="Pick a version" description={`Select a version on the left to see what changed in ${selectedFile.path}.`} />
        ) : selectedFile.type === "image" || selectedFile.type === "folder" ? (
          <EmptyState title="Not diffable" description="Diffing is only available for text files (.tex/.bib/etc.)." />
        ) : diffLoading ? (
          <div className={styles.centered}>
            <Spinner />
          </div>
        ) : (
          <>
            <div className={styles.detailHeader}>
              <span className={styles.detailPath}>{selectedFile.path}</span>
              {canWrite && (
                <Button variant="danger" size="sm" onClick={() => setConfirmingRestore(true)}>
                  Restore to this version
                </Button>
              )}
            </div>
            <DiffView
              oldText={snapshotContent ?? ""}
              newText={currentContent ?? ""}
              oldLabel="This version"
              newLabel="Current"
            />
          </>
        )}
      </div>

      {confirmingRestore && (
        <div className={styles.overlay} role="presentation">
          <div className={styles.confirmCard} role="dialog" aria-modal="true" aria-label="Confirm restore">
            <h3 className={styles.confirmTitle}>Restore this version?</h3>
            <p className={styles.confirmBody}>
              This replaces every file in the project with this version's content — files added since will be
              removed, files deleted since will come back. A backup of the current state is saved automatically
              first, so this can always be undone.
            </p>
            <div className={styles.confirmActions}>
              <Button variant="ghost" onClick={() => setConfirmingRestore(false)} disabled={restoring}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRestore} loading={restoring}>
                Restore
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
