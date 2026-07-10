import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { EmptyState } from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { Button } from "../components/ui/Button";
import { useAuth } from "../lib/auth";
import { safeNextPath } from "../lib/urlsafety";

export function MagicLinkCallbackPage() {
  const [searchParams] = useSearchParams();
  const { verifyMagicLink } = useAuth();
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
    const next = safeNextPath(searchParams.get("next")) ?? "/projects";
    verifyMagicLink(token)
      .then(() => navigate(next, { replace: true }))
      .catch((err: Error) => setError(err.message));
  }, [searchParams, verifyMagicLink, navigate]);

  if (error) {
    return (
      <EmptyState
        title="Sign-in link didn't work"
        description={error}
        action={<Button onClick={() => navigate("/login")}>Back to sign in</Button>}
      />
    );
  }

  return <PageSpinner />;
}
