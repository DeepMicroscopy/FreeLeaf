import { api, apiOrigin } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mail, Star, Users } from "lucide-react";

import { PenguinMascot } from "../components/workspace/PenguinMascot";
import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { PageSpinner } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { OrcidMark } from "../components/auth/OrcidMark";
import { orcidLoginUrl, useAuth } from "../lib/auth";
import { useSiteInfo } from "../lib/siteInfo";
import loginStyles from "./LoginPage.module.css";
import styles from "./JoinPage.module.css";

type MagicLinkState = "idle" | "sending" | "sent";
type SharePreview = components["schemas"]["ShareLinkPreviewOut"];

export function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const { user, loading, refresh, requestMagicLink } = useAuth();
  const { siteName } = useSiteInfo();
  const navigate = useNavigate();

  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const attemptedAutoJoin = useRef(false);

  // The greeting (who invited you, to what) is fetched and shown up front —
  // before picking how to identify yourself, not only after joining (see
  // ProjectWelcome.tsx for the equivalent post-join screen) — so this isn't
  // the viewer's first impression of a bare, unexplained sign-in box.
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [previewInvalid, setPreviewInvalid] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [magicLinkState, setMagicLinkState] = useState<MagicLinkState>("idle");
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.GET("/api/share-links/{token}", { params: { path: { token } } }).then(({ data, error }) => {
      if (error || !data) setPreviewInvalid(true);
      else setPreview(data);
    });
  }, [token]);

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
      await requestMagicLink(email.trim(), token, `/join/${token}`);
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

  if (previewInvalid) {
    return (
      <EmptyState
        icon={<Users size={32} aria-hidden="true" />}
        title="Invite link not found"
        description="This invite link is invalid, has expired, or has been revoked by the project owner."
      />
    );
  }

  return (
    <div className={loginStyles.page}>
      <div className={[loginStyles.card, styles.card].join(" ")}>
        <div className={styles.greeting}>
          <PenguinMascot pose="happy" size={64} />
          <div>
            <h1 className={loginStyles.title}>Welcome to {siteName}</h1>
            {preview ? (
              <p className={styles.inviteLine}>
                {preview.invited_by_name ? (
                  <>
                    <strong>{preview.invited_by_name}</strong> invited you to join{" "}
                  </>
                ) : (
                  "You've been invited to join "
                )}
                <strong>{preview.project_name}</strong>
              </p>
            ) : (
              <p className={styles.inviteLine}>Loading your invite…</p>
            )}
          </div>
        </div>

        {preview?.has_thumbnail && (
          <img className={styles.thumbnail} src={`${apiOrigin()}/api/share-links/${token}/thumbnail`} alt="" />
        )}

        <p className={styles.description}>
          {siteName} is a self-hostable, collaborative LaTeX editor — write and compile together in real time, with
          a live PDF preview, inline comments, and tracked-suggestion reviewing, all in the browser.
        </p>

        {joinError && <p className={styles.error}>{joinError}</p>}

        <div className={styles.identifyIntro}>
          <h2 className={styles.identifyHeading}>Choose how we should identify you</h2>
          <p className={styles.identifyReason}>
            The project's collaborators will see this name next to any comments or edits you make — so before you
            can start, let them know who you are.
          </p>
        </div>

        <div>
          <a className={loginStyles.orcidButton} href={orcidLoginUrl(`/join/${token}`)}>
            <OrcidMark />
            Sign in with ORCID
          </a>
          <p className={styles.recommendedHint}>
            <Star size={12} aria-hidden="true" />
            Recommended — sign back in anytime from the login page and see every project you've been invited to, all
            in one place.
          </p>
        </div>

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
            <p className={styles.optionHint}>We'll email a one-time sign-in link for this invite.</p>
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
          <p className={styles.optionHint}>
            No account needed — fastest to get started, but you won't be able to sign back in from another device or
            browser.
          </p>
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
