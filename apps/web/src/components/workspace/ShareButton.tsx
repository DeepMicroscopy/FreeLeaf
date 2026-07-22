import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useState } from "react";
import { Check, Copy, Crown, Share2, X } from "lucide-react";

import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import styles from "./ShareButton.module.css";

type MemberOut = components["schemas"]["MemberOut"];
type ShareRole = "editor" | "reviewer" | "viewer";

const ROLE_DESCRIPTIONS: Record<ShareRole, string> = {
  editor: "Anyone with this link can join as an editor — including anonymously, with just a display name.",
  reviewer:
    "Anyone with this link joins as a reviewer — locked to Reviewing mode, and every change they make is a " +
    "tracked suggestion, never a direct edit.",
  viewer: "Anyone with this link can view the project, read-only.",
};

export function ShareButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<ShareRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<MemberOut[] | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !link) await generate(role);
    if (next) {
      const { data } = await api.GET("/api/projects/{project_id}/members", {
        params: { path: { project_id: projectId } },
      });
      setMembers(data ?? []);
    }
  }

  async function generate(forRole: ShareRole) {
    setGenerating(true);
    setError(false);
    const { data, error: reqError } = await api.POST("/api/projects/{project_id}/share-links", {
      params: { path: { project_id: projectId } },
      body: { role: forRole },
    });
    setGenerating(false);
    if (reqError || !data?.token) {
      setError(true);
      return;
    }
    setLink(`${window.location.origin}/join/${data.token}`);
  }

  async function changeShareRole(next: ShareRole) {
    setRole(next);
    setLink(null);
    await generate(next);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function changeRole(userId: string, role: string) {
    const { data, error: reqError } = await api.PATCH("/api/projects/{project_id}/members/{member_user_id}", {
      params: { path: { project_id: projectId, member_user_id: userId } },
      body: { role },
    });
    if (!reqError && data) {
      setMembers((prev) => prev?.map((m) => (m.user_id === userId ? data : m)) ?? null);
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm("Remove this person's access to the project?")) return;
    const { error: reqError } = await api.DELETE("/api/projects/{project_id}/members/{member_user_id}", {
      params: { path: { project_id: projectId, member_user_id: userId } },
    });
    if (!reqError) {
      setMembers((prev) => prev?.filter((m) => m.user_id !== userId) ?? null);
    }
  }

  async function transferOwnership(userId: string, displayName: string) {
    if (
      !window.confirm(
        `Make ${displayName} the owner of this project? You'll become an editor and lose owner-only ` +
          "controls (managing members, deleting the project).",
      )
    ) {
      return;
    }
    const { data, error: reqError } = await api.POST(
      "/api/projects/{project_id}/members/{member_user_id}/transfer-ownership",
      { params: { path: { project_id: projectId, member_user_id: userId } } },
    );
    if (!reqError && data) {
      setMembers(data);
    }
  }

  const isOwner = members?.some((m) => m.is_you && m.role === "owner") ?? false;

  return (
    <div className={styles.wrapper}>
      <Button variant="secondary" size="sm" onClick={toggle} className={styles.trigger}>
        <Share2 size={14} aria-hidden="true" />
        Share
      </Button>
      {open && (
        <>
          <button className={styles.backdrop} aria-label="Close" onClick={() => setOpen(false)} />
          <div className={styles.popover}>
            <p className={styles.title}>Invite collaborators</p>
            <label className={styles.shareRoleField}>
              <span className={styles.shareRoleLabel}>Link role</span>
              <select
                className={styles.roleSelect}
                value={role}
                disabled={generating}
                onChange={(e) => void changeShareRole(e.target.value as ShareRole)}
              >
                <option value="editor">Editor</option>
                <option value="reviewer">Reviewer</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <p className={styles.description}>{ROLE_DESCRIPTIONS[role]}</p>
            {generating ? (
              <div className={styles.loading}>
                <Spinner size={16} />
              </div>
            ) : error ? (
              <p className={styles.error}>
                Couldn't create a link. <button type="button" onClick={() => void generate(role)}>Try again</button>
              </p>
            ) : (
              <div className={styles.linkRow}>
                <input className={styles.linkInput} readOnly value={link ?? ""} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}

            <div className={styles.divider} />
            <p className={styles.title}>People with access</p>
            {members === null ? (
              <div className={styles.loading}>
                <Spinner size={16} />
              </div>
            ) : (
              <ul className={styles.memberList}>
                {members.map((m) => (
                  <li key={m.user_id} className={styles.memberRow}>
                    <span className={styles.memberName}>
                      {m.display_name}
                      {m.is_you && <span className={styles.youTag}> (you)</span>}
                    </span>
                    {m.role === "owner" || m.is_you ? (
                      <span className={[styles.roleBadge, styles[`role_${m.role}`]].join(" ")}>{m.role}</span>
                    ) : (
                      <span className={styles.memberControls}>
                        <select
                          className={styles.roleSelect}
                          value={m.role}
                          onChange={(e) => changeRole(m.user_id, e.target.value)}
                        >
                          <option value="editor">editor</option>
                          <option value="reviewer">reviewer</option>
                          <option value="viewer">viewer</option>
                        </select>
                        {isOwner && (
                          <button
                            type="button"
                            className={styles.removeButton}
                            aria-label={`Make ${m.display_name} the owner`}
                            title="Make owner"
                            onClick={() => transferOwnership(m.user_id, m.display_name)}
                          >
                            <Crown size={13} aria-hidden="true" />
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.removeButton}
                          aria-label={`Remove ${m.display_name}`}
                          onClick={() => removeMember(m.user_id)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
