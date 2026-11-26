import { api, apiOrigin } from "@freeleaf/shared";
import { useState } from "react";
import { FileText, GitBranch, MessageSquare, Users } from "lucide-react";

import type { ProjectOut } from "../../lib/workspace";
import { Button } from "../ui/Button";
import { PenguinMascot } from "./PenguinMascot";
import styles from "./ProjectWelcome.module.css";

// Only ever shown to an invited member (owners create their own project,
// never joining via a ShareLink), so there's always a role-appropriate
// single "direct entry" action rather than a three-way editing/reviewing/
// reading picker — switching between those is already a first-class
// in-workspace feature (ModeSwitcher) once past this screen.
const ROLE_ACTION_LABEL: Record<string, string> = {
  editor: "Start editing",
  reviewer: "Start reviewing",
  viewer: "Start reading",
};

const FEATURES = [
  {
    icon: FileText,
    title: "Live PDF preview",
    body: "Compiles your LaTeX and shows the typeset PDF side by side as you write.",
  },
  {
    icon: Users,
    title: "Real-time collaboration",
    body: "Everyone's cursor and edits show up live, like a shared document.",
  },
  {
    icon: MessageSquare,
    title: "Reviewing mode",
    body: "Suggest changes as tracked edits and leave inline comments, without touching the real text.",
  },
  {
    icon: GitBranch,
    title: "Revision diffs",
    body: "Link a document to an earlier version to see exactly what's changed since then.",
  },
];

export function ProjectWelcome({
  projectId,
  project,
  onDone,
}: {
  projectId: string;
  project: ProjectOut;
  onDone: () => void;
}) {
  const [showIntro, setShowIntro] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const actionLabel = ROLE_ACTION_LABEL[project.role] ?? "Continue";

  async function finish() {
    setDismissing(true);
    await api.POST("/api/projects/{project_id}/welcome-seen", {
      params: { path: { project_id: projectId } },
    });
    onDone();
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {!showIntro ? (
          <>
            <div className={styles.header}>
              <PenguinMascot pose="happy" size={92} />
              <div>
                <h1 className={styles.title}>Welcome to FreeLeaf</h1>
                <p className={styles.invite}>
                  {project.invited_by_name ? (
                    <>
                      <strong>{project.invited_by_name}</strong> invited you to join{" "}
                    </>
                  ) : (
                    "You've been invited to join "
                  )}
                  <strong>{project.name}</strong>
                </p>
              </div>
            </div>

            {project.has_thumbnail && (
              <img
                className={styles.thumbnail}
                src={`${apiOrigin()}/api/projects/${projectId}/thumbnail`}
                alt=""
              />
            )}

            <p className={styles.description}>
              FreeLeaf is a self-hostable, collaborative LaTeX editor — write and compile together in real time,
              with a live PDF preview, inline comments, and tracked-suggestion reviewing, all in the browser.
            </p>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setShowIntro(true)} disabled={dismissing}>
                Introduce me to the tool
              </Button>
              <Button variant="primary" onClick={finish} loading={dismissing}>
                {actionLabel}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.header}>
              <PenguinMascot pose="happy" size={72} />
              <h1 className={styles.title}>What you can do here</h1>
            </div>

            <ul className={styles.featureList}>
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className={styles.feature}>
                  <Icon size={18} aria-hidden="true" className={styles.featureIcon} />
                  <div>
                    <p className={styles.featureTitle}>{title}</p>
                    <p className={styles.featureBody}>{body}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setShowIntro(false)} disabled={dismissing}>
                Back
              </Button>
              <Button variant="primary" onClick={finish} loading={dismissing}>
                {actionLabel}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
