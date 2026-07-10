import { api, apiOrigin, ensureCsrfCookie } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type CurrentUser = components["schemas"]["UserOut"];

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  // shareLinkToken is required, not optional: magic-link sign-in only works
  // when accepting a project invite (see JoinPage) — the backend rejects
  // requests without a valid, matching ShareLink token. No standalone
  // "email me a link" entry point on the generic login page anymore.
  requestMagicLink: (email: string, shareLinkToken: string, next?: string) => Promise<void>;
  verifyMagicLink: (token: string) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await api.GET("/api/auth/me");
    setUser(data ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      await ensureCsrfCookie();
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const requestMagicLink = useCallback(async (email: string, shareLinkToken: string, next?: string) => {
    const { error } = await api.POST("/api/auth/magic-link/request", {
      body: { email, next: next ?? null, share_link_token: shareLinkToken },
    });
    if (error) throw new Error("Could not send sign-in link.");
  }, []);

  const verifyMagicLink = useCallback(async (token: string) => {
    const { data, error } = await api.POST("/api/auth/magic-link/verify", { body: { token } });
    if (error || !data) throw new Error("This sign-in link is invalid or has expired.");
    setUser(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await api.POST("/api/auth/logout");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, requestMagicLink, verifyMagicLink, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function orcidLoginUrl(next?: string): string {
  const url = `${apiOrigin()}/api/auth/orcid/login`;
  return next ? `${url}?next=${encodeURIComponent(next)}` : url;
}
