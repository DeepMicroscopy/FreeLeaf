import { api } from "@freeleaf/shared";
import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import styles from "./ShareButton.module.css";

export function ShareButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !link) await generate();
  }

  async function generate() {
    setGenerating(true);
    setError(false);
    const { data, error: reqError } = await api.POST("/api/projects/{project_id}/share-links", {
      params: { path: { project_id: projectId } },
      body: { role: "editor" },
    });
    setGenerating(false);
    if (reqError || !data?.token) {
      setError(true);
      return;
    }
    setLink(`${window.location.origin}/join/${data.token}`);
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={styles.wrapper}>
      <Button variant="secondary" size="sm" onClick={toggle}>
        <Share2 size={14} aria-hidden="true" />
        Share
      </Button>
      {open && (
        <>
          <button className={styles.backdrop} aria-label="Close" onClick={() => setOpen(false)} />
          <div className={styles.popover}>
            <p className={styles.title}>Invite collaborators</p>
            <p className={styles.description}>
              Anyone with this link can join as an editor — including anonymously, with just a display
              name.
            </p>
            {generating ? (
              <div className={styles.loading}>
                <Spinner size={16} />
              </div>
            ) : error ? (
              <p className={styles.error}>Couldn't create a link. <button type="button" onClick={generate}>Try again</button></p>
            ) : (
              <div className={styles.linkRow}>
                <input className={styles.linkInput} readOnly value={link ?? ""} onFocus={(e) => e.target.select()} />
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
