import { api } from "@freeleaf/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";

/** Completes the first-run setup wizard's bootstrap magic-link sign-in
 * (Plan.md §9 Phase 11) — deliberately a *separate* page/endpoint from
 * `MagicLinkCallbackPage`/`/api/auth/magic-link/verify`, so this ungated
 * bootstrap path can never be reached through (or confused with) the
 * normal invite-gated magic-link flow. See setup_api.py's docstring.
 *
 * Finishes with a hard page load (not an in-app `navigate`) rather than
 * a client-side transition, same as the ORCID flow's server redirect —
 * `App.tsx`'s setup gate only fetches `needs_setup` once per page load,
 * so an in-app navigation would carry that now-stale "still needs setup"
 * state straight back to this page in a loop. */
export function SetupVerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setError("This sign-in link is missing its token.");
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    api.POST("/api/setup/verify-admin-link", { body: { token } }).then(({ data, error: verifyError }) => {
      if (!data) {
        setError((verifyError as { detail?: string })?.detail ?? "This sign-in link didn't work.");
        return;
      }
      window.location.href = "/projects";
    });
  }, [searchParams]);

  if (error) {
    return (
      <EmptyState
        title="Sign-in link didn't work"
        description={error}
        action={<Button onClick={() => navigate("/setup")}>Back to setup</Button>}
      />
    );
  }

  return <PageSpinner />;
}
