import { api } from "@freeleaf/shared";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mail, Users } from "lucide-react";

import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { PageSpinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { OrcidMark } from "../components/auth/OrcidMark";
import { orcidLoginUrl, useAuth } from "../lib/auth";
import loginStyles from "./LoginPage.module.css";
import styles from "./JoinPage.module.css";

type MagicLinkState = "idle" | "sending" | "sent";

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading, refresh, requestMagicLink } = useAuth();
  const navigate = useNavigate();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const attemptedAutoJoin = useRef(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [magicLinkState, setMagicLinkState] = useState<MagicLinkState>("idle");
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  async function join(name?: string) {
    if (!token) return;
    setJoining(true);
    setJoinError(null);
    const { data, error } = await api.POST("/api/share-links/{token}/join", {
      params: { path: { token } },
      body: { display_name: name || null },
    });
    if (error || !data) {
      setJoinError("This invite link is invalid or has expired, or you've hit the rate limit — try again shortly.");
      setJoining(false);
      return;
    }
    await refresh();
    navigate(`/projects/${data.id}`, { replace: true });
  }

  // Already signed in (any kind, e.g. returning from ORCID/magic-link, or an
  // existing session) — join immediately, no extra prompt needed.
  useEffect(() => {
    if (loading || !user || attemptedAutoJoin.current) return;
    attemptedAutoJoin.current = true;
    join();
  }, [loading, user]);

  async function handleGuestJoin(e: FormEvent) {
    e.preventDefault();
    await join(displayName.trim() || undefined);
  }

  async function handleMagicLinkSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !token) return;
    setMagicLinkError(null);
    setMagicLinkState("sending");
    try {
      await requestMagicLink(email.trim(), `/join/${token}`);
      setMagicLinkState("sent");
    } catch {
      setMagicLinkError("Something went wrong. Please try again.");
      setMagicLinkState("idle");
    }
  }

  if (!token) {
    return <EmptyState title="Invalid invite link" description="This invite link is missing its token." />;
  }

  if (loading || (user && joining && !joinError)) {
    return <PageSpinner />;
  }

  if (user) {
    // Signed in but the auto-join above failed.
    return (
      <EmptyState
        icon={<Users size={32} aria-hidden="true" />}
        title="Couldn't join"
        description={joinError ?? "This invite link is invalid or has expired."}
        action={<Button onClick={() => navigate("/projects")}>Go to your projects</Button>}
      />
    );
  }

  return (
    <div className={loginStyles.page}>
      <div className={loginStyles.card}>
        <div className={loginStyles.brand}>
          <span className={loginStyles.logo} aria-hidden="true">
            🍃
          </span>
          <h1 className={loginStyles.title}>You're invited</h1>
        </div>
        <p className={loginStyles.tagline}>Join this FreeLeaf project to start collaborating.</p>

        {joinError && <p className={styles.error}>{joinError}</p>}

        <a className={loginStyles.orcidButton} href={orcidLoginUrl(`/join/${token}`)}>
          <OrcidMark />
          Sign in with ORCID
        </a>

        <div className={loginStyles.divider}>
          <span>or</span>
        </div>

        {magicLinkState === "sent" ? (
          <div className={loginStyles.sentNotice}>
            <Mail size={18} aria-hidden="true" />
            <div>
              <p className={loginStyles.sentTitle}>Check your inbox</p>
              <p className={loginStyles.sentBody}>
                We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
              </p>
            </div>
          </div>
        ) : (
          <form className={loginStyles.form} onSubmit={handleMagicLinkSubmit}>
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
            <Button type="submit" loading={magicLinkState === "sending"} className={loginStyles.fullWidth}>
              Email me a sign-in link
            </Button>
          </form>
        )}

        <div className={loginStyles.divider}>
          <span>or</span>
        </div>

        <form className={styles.guestForm} onSubmit={handleGuestJoin}>
          <TextField
            label="Display name (optional)"
            placeholder="Anonymous Panda"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Button type="submit" variant="secondary" className={loginStyles.fullWidth} loading={joining}>
            Continue as guest
          </Button>
        </form>
      </div>
    </div>
  );
}
