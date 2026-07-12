import { api } from "@freeleaf/shared";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { BrowserRouter } from "react-router-dom";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuth } from "./lib/auth";
import { PageSpinner } from "./components/ui/Spinner";
import { AdminPage } from "./routes/AdminPage";
import { JoinPage } from "./routes/JoinPage";
import { LoginPage } from "./routes/LoginPage";
import { MagicLinkCallbackPage } from "./routes/MagicLinkCallbackPage";
import { ProjectsPage } from "./routes/ProjectsPage";
import { ProjectWorkspace } from "./routes/ProjectWorkspace";
import { SetupVerifyPage } from "./routes/SetupVerifyPage";
import { SetupWizardPage } from "./routes/SetupWizardPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (user) return <Navigate to="/projects" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) return <Navigate to="/projects" replace />;
  return <>{children}</>;
}

/** First-run setup gate (Plan.md §9 Phase 11): fetched once per page load
 * (not re-polled — the setup pages themselves force a hard page load when
 * they're done, see SetupVerifyPage, so a stale in-memory value here can't
 * cause a redirect loop). While no admin exists yet, every route except
 * `/setup`/`/setup/verify` bounces to the setup wizard instead of the
 * normal login page; once an admin exists, `/setup` itself bounces to
 * `/login`. */
function useNeedsSetup(): boolean | null {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.GET("/api/setup/status").then(({ data }) => {
      if (!cancelled) setNeedsSetup(data?.needs_setup ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return needsSetup;
}

function AppRoutes() {
  const needsSetup = useNeedsSetup();
  const location = useLocation();

  if (needsSetup === null) return <PageSpinner />;
  if (needsSetup && location.pathname !== "/setup" && location.pathname !== "/setup/verify") {
    return <Navigate to="/setup" replace />;
  }
  if (!needsSetup && location.pathname === "/setup") {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route path="/setup/verify" element={<SetupVerifyPage />} />
      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />
      <Route path="/auth/magic-link" element={<MagicLinkCallbackPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/projects"
        element={
          <RequireAuth>
            <ProjectsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/projects/:projectId/*"
        element={
          <RequireAuth>
            <ProjectWorkspace />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminPage />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
