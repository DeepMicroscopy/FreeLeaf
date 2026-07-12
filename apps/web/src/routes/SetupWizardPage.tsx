import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Mail, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../components/ui/Button";
import { TextField } from "../components/ui/TextField";
import { PageSpinner } from "../components/ui/Spinner";
import { OrcidMark } from "../components/auth/OrcidMark";
import { orcidLoginUrl } from "../lib/auth";
import loginStyles from "./LoginPage.module.css";

type SetupStatusOut = components["schemas"]["SetupStatusOut"];

/** First-run setup (Plan.md §9 Phase 11): shown instead of the normal login
 * page whenever no admin user exists yet on this instance (gated by
 * `SetupGate` in App.tsx, driven by `GET /api/setup/status`). Lets the
 * visitor pick whether ORCID sign-in should be available at all, then
 * complete sign-in through it (or a one-time bootstrap email link) —
 * whichever identity finishes that becomes the site's first admin. */
export function SetupWizardPage() {
  const [status, setStatus] = useState<SetupStatusOut | null>(null);
  const [togglingOrcid, setTogglingOrcid] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.GET("/api/setup/status").then(({ data }) => setStatus(data ?? null));
  }, []);

  async function toggleOrcid() {
    if (!status) return;
    setTogglingOrcid(true);
    const { data } = await api.PUT("/api/setup/orcid-enabled", { body: { orcid_enabled: !status.orcid_enabled } });
    setTogglingOrcid(false);
    if (data) setStatus(data);
  }

  async function handleRequestLink(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    const { error: reqError } = await api.POST("/api/setup/request-admin-link", { body: { email } });
    setSending(false);
    if (reqError) {
      setError((reqError as { detail?: string }).detail ?? "Couldn't send the sign-in link.");
      return;
    }
    setSent(true);
  }

  if (!status) return <PageSpinner />;

  return (
    <div className={loginStyles.page}>
      <div className={loginStyles.card}>
        <div className={loginStyles.brand}>
          <span className={loginStyles.logo} aria-hidden="true">
            🍃
          </span>
          <h1 className={loginStyles.title}>Welcome to FreeLeaf</h1>
        </div>
        <p className={loginStyles.tagline}>
          <ShieldCheck size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> No admin account exists yet on
          this instance. Sign in below to create the first one.
        </p>

        <section>
          <p className={loginStyles.footnote} style={{ marginBottom: 6 }}>
            1. Choose which sign-in methods are available
          </p>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              opacity: status.orcid_configured ? 1 : 0.5,
            }}
          >
            <input
              type="checkbox"
              checked={status.orcid_enabled}
              disabled={togglingOrcid || !status.orcid_configured}
              onChange={() => void toggleOrcid()}
            />
            ORCID sign-in
            {!status.orcid_configured && " (not configured — set ORCID_CLIENT_ID/ORCID_CLIENT_SECRET first)"}
          </label>
          <p className={loginStyles.footnote} style={{ marginTop: 2 }}>
            Institutional SSO (SAML/LDAP) can be added after setup, from the admin panel.
          </p>
        </section>

        <section>
          <p className={loginStyles.footnote} style={{ marginBottom: 6 }}>
            2. Sign in to become the admin
          </p>

          {status.orcid_available && (
            <a className={loginStyles.orcidButton} href={orcidLoginUrl("/projects")}>
              <OrcidMark />
              Sign in with ORCID
            </a>
          )}

          {status.orcid_available && <div className={loginStyles.divider}>or</div>}

          {sent ? (
            <div className={loginStyles.sentNotice}>
              <Mail size={18} aria-hidden="true" />
              <div>
                <p className={loginStyles.sentTitle}>Check your inbox</p>
                <p className={loginStyles.sentBody}>
                  We sent a one-time sign-in link to {email}. Open it on this device to finish setup.
                </p>
              </div>
            </div>
          ) : (
            <form className={loginStyles.form} onSubmit={handleRequestLink}>
              <TextField
                label="Email address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus={!status.orcid_available}
              />
              {error && <p className={loginStyles.footnote}>{error}</p>}
              <Button type="submit" className={loginStyles.fullWidth} loading={sending}>
                Send me a sign-in link
              </Button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
