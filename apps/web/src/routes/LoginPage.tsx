import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { TextField } from "../components/ui/TextField";
import { Button } from "../components/ui/Button";
import { orcidLoginUrl, samlLoginUrl, useAuth } from "../lib/auth";
import { useSiteInfo } from "../lib/siteInfo";
import { OrcidMark } from "../components/auth/OrcidMark";
import styles from "./LoginPage.module.css";

type SsoProviderPublicOut = components["schemas"]["SsoProviderPublicOut"];

export function LoginPage() {
  const { ldapLogin } = useAuth();
  const { siteName } = useSiteInfo();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<SsoProviderPublicOut[]>([]);
  const [orcidAvailable, setOrcidAvailable] = useState(true);
  const [ldapSlug, setLdapSlug] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.GET("/api/auth/sso/providers").then(({ data }) => setProviders(data ?? []));
    api.GET("/api/setup/status").then(({ data }) => setOrcidAvailable(data?.orcid_available ?? false));
  }, []);

  async function handleLdapSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ldapSlug) return;
    setSubmitting(true);
    setError(null);
    try {
      await ldapLogin(ldapSlug, username, password);
      navigate("/projects", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            🍃
          </span>
          <h1 className={styles.title}>{siteName}</h1>
        </div>
        <p className={styles.tagline}>
          Open, self-hostable, collaborative LaTeX editing.
        </p>

        {orcidAvailable && (
          <a className={styles.orcidButton} href={orcidLoginUrl()}>
            <OrcidMark />
            Sign in with ORCID
          </a>
        )}

        {providers.length > 0 && (
          <>
            <div className={styles.divider}>
              {orcidAvailable ? "or sign in with your institution" : "sign in with your institution"}
            </div>
            {providers.map((p) =>
              p.kind === "saml" ? (
                <a key={p.slug} className={styles.orcidButton} href={samlLoginUrl(p.slug)}>
                  <Building2 size={16} aria-hidden="true" />
                  {p.name}
                </a>
              ) : (
                <Button
                  key={p.slug}
                  variant="secondary"
                  className={styles.fullWidth}
                  onClick={() => {
                    setLdapSlug(ldapSlug === p.slug ? null : p.slug);
                    setError(null);
                  }}
                >
                  <Building2 size={16} aria-hidden="true" />
                  {p.name}
                </Button>
              ),
            )}
            {ldapSlug && (
              <form className={styles.form} onSubmit={handleLdapSubmit}>
                <TextField
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                />
                <TextField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {error && <p className={styles.footnote}>{error}</p>}
                <Button type="submit" className={styles.fullWidth} loading={submitting}>
                  Sign in
                </Button>
              </form>
            )}
          </>
        )}

        <p className={styles.footnote}>
          Signing in by email or contributing anonymously both require an invite link from a
          project owner — use the link they sent you instead of signing in here.
        </p>
      </div>
    </div>
  );
}
