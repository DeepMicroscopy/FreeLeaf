import createClient, { type Middleware } from "openapi-fetch";

import type { paths } from "./generated";

const DEFAULT_BASE_URL = "http://localhost:8000";

// Origin only — generated `paths` keys already include the "/api" prefix
// Django Ninja mounts everything under (see apps/api/config/urls.py).
export function apiOrigin(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_ORIGIN ?? DEFAULT_BASE_URL;
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Django's double-submit-cookie CSRF check (see apps/api/accounts/auth.py):
// unsafe requests must echo the csrftoken cookie back as a header.
// ensureCsrfCookie() primes the cookie; call it once at app bootstrap.
const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (!SAFE_METHODS.has(request.method)) {
      const token = readCookie("csrftoken");
      if (token) request.headers.set("X-CSRFToken", token);
    }
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: apiOrigin(), credentials: "include" });
api.use(csrfMiddleware);

export async function ensureCsrfCookie(): Promise<void> {
  await api.GET("/api/auth/csrf");
}
