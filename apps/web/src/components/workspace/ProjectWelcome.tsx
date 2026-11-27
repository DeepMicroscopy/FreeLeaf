import { api, apiOrigin } from "@freeleaf/shared";
import { useState } from "react";
import { Code2, FileText, GitBranch, MessageSquare, Users } from "lucide-react";

import type { ProjectOut } from "../../lib/workspace";
import { useSiteInfo } from "../../lib/siteInfo";
import { Button } from "../ui/Button";
import { PenguinMascot } from "./PenguinMascot";
import { TourVisual } from "./TourVisual";
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

const TOUR_STEPS = [
  {
    icon: Code2,
    title: "Write in a real LaTeX editor",
    body: "Syntax highlighting and inline error checks as you type — no local TeX install needed.",
    visual: "editor",
  },
  {
    icon: FileText,
    title: "Watch the PDF update as you go",
    body: "Every change recompiles in a sandboxed TeX Live container and refreshes the preview right next to your source.",
    visual: "pdf",
  },
  {
    icon: Users,
    title: "Collaborate in real time",
    body: "Everyone's cursor and edits appear instantly, like a shared document — no more emailing .tex files back and forth.",
    visual: "collab",
  },
  {
    icon: MessageSquare,
    title: "Comment and suggest changes",
    body: "Reviewers can leave inline comments or propose tracked edits without touching the real text.",
    visual: "review",
  },
  {
    icon: GitBranch,
    title: "Track what's changed since any version",
    body: "Link a document to an earlier revision to see a permanent diff against it — handy when revising against reviewer feedback.",
    visual: "diff",
  },
] as const;

export function ProjectWelcome({
  projectId,
  project,
  onDone,
}: {
  projectId: string;
  project: ProjectOut;
  onDone: () => void;
}) {
  const { siteName } = useSiteInfo();
  const [showIntro, setShowIntro] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const actionLabel = ROLE_ACTION_LABEL[project.role] ?? "Continue";
  const isLastTourStep = tourStep === TOUR_STEPS.length - 1;

  async function finish() {
    setDismissing(true);
    await api.POST("/api/projects/{project_id}/welcome-seen", {
      params: { path: { project_id: projectId } },
    });
    onDone();
  }

  function backFromTour() {
    if (tourStep === 0) {
      setShowIntro(false);
    } else {
      setTourStep((step) => step - 1);
    }
  }

  function advanceTour() {
    if (isLastTourStep) {
      finish();
    } else {
      setTourStep((step) => step + 1);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {!showIntro ? (
          <>
            <div className={styles.header}>
              <PenguinMascot pose="happy" size={92} />
              <div>
                <h1 className={styles.title}>Welcome to {siteName}</h1>
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

            <div className={styles.actions}>
              <Button
                variant="secondary"
                onClick={() => {
                  setTourStep(0);
                  setShowIntro(true);
                }}
                disabled={dismissing}
              >
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
              <PenguinMascot pose="happy" size={56} />
              <h1 className={styles.title}>A quick tour</h1>
            </div>

            <TourVisual kind={TOUR_STEPS[tourStep].visual} />

            <div>
              <div className={styles.tourStepHeader}>
                {(() => {
                  const Icon = TOUR_STEPS[tourStep].icon;
                  return <Icon size={16} aria-hidden="true" className={styles.tourStepIcon} />;
                })()}
                <p className={styles.tourStepTitle}>{TOUR_STEPS[tourStep].title}</p>
              </div>
              <p className={styles.description}>{TOUR_STEPS[tourStep].body}</p>
            </div>

            <div className={styles.tourDots}>
              {TOUR_STEPS.map((step, i) => (
                <button
                  key={step.title}
                  type="button"
                  className={[styles.tourDot, i === tourStep ? styles.tourDotActive : ""].join(" ")}
                  aria-label={`Go to step ${i + 1} of ${TOUR_STEPS.length}`}
                  aria-current={i === tourStep}
                  onClick={() => setTourStep(i)}
                />
              ))}
            </div>

            <div className={styles.actions}>
              <Button variant="secondary" onClick={backFromTour} disabled={dismissing}>
                Back
              </Button>
              <Button variant="primary" onClick={advanceTour} loading={dismissing && isLastTourStep}>
                {isLastTourStep ? actionLabel : "Next"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
