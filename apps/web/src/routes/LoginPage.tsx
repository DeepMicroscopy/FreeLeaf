import { useState } from "react";
import type { FormEvent } from "react";
import { Mail } from "lucide-react";

import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { orcidLoginUrl, useAuth } from "../lib/auth";
import { OrcidMark } from "../components/auth/OrcidMark";
import styles from "./LoginPage.module.css";

type MagicLinkState = "idle" | "sending" | "sent";

export function LoginPage() {
  const { requestMagicLink } = useAuth();

  const [email, setEmail] = useState("");
  const [magicLinkState, setMagicLinkState] = useState<MagicLinkState>("idle");
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  async function handleMagicLinkSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setMagicLinkError(null);
    setMagicLinkState("sending");
    try {
      await requestMagicLink(email.trim());
      setMagicLinkState("sent");
    } catch {
      setMagicLinkError("Something went wrong. Please try again.");
      setMagicLinkState("idle");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            🍃
          </span>
          <h1 className={styles.title}>FreeLeaf</h1>
        </div>
        <p className={styles.tagline}>
          Open, self-hostable, collaborative LaTeX editing.
        </p>

        <a className={styles.orcidButton} href={orcidLoginUrl()}>
          <OrcidMark />
          Sign in with ORCID
        </a>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        {magicLinkState === "sent" ? (
          <div className={styles.sentNotice}>
            <Mail size={18} aria-hidden="true" />
            <div>
              <p className={styles.sentTitle}>Check your inbox</p>
              <p className={styles.sentBody}>
                We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
              </p>
            </div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleMagicLinkSubmit}>
            <TextField
              label="Email"
              type="email"
              placeholder="you@university.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={magicLinkError ?? undefined}
              autoComplete="email"
              required
            />
            <Button type="submit" loading={magicLinkState === "sending"} className={styles.fullWidth}>
              Email me a sign-in link
            </Button>
          </form>
        )}

        <p className={styles.footnote}>
          Contributing anonymously to a project? You'll need an invite link from its owner.
        </p>
      </div>
    </div>
  );
}
