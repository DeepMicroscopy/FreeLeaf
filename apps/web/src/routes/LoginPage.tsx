import { orcidLoginUrl } from "../lib/auth";
import { OrcidMark } from "../components/auth/OrcidMark";
import styles from "./LoginPage.module.css";

export function LoginPage() {
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

        <p className={styles.footnote}>
          Signing in by email or contributing anonymously both require an invite link from a
          project owner — use the link they sent you instead of signing in here.
        </p>
      </div>
    </div>
  );
}
